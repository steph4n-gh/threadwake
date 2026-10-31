"""Offline game-action inference with a measured, reversible residual intervention."""
from __future__ import annotations

import argparse
import contextlib
import gc
import hashlib
import json
import math
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import time
from datetime import datetime, timezone

import campaign_mind
import model_config

ROOT = Path(__file__).resolve().parent
MODEL_VARIANTS = model_config.MANIFEST
ACTIONS = ('BRIDGE', 'SHELTER', 'SURGE')
BOARDS = ('archive', 'garden', 'choir', 'core')
SOURCE_SHA256 = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                 for name in ('brain.py', 'campaign_mind.py', 'local_model.py', 'model_config.py', 'models.json', 'uv.lock')}
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', TOKENIZERS_PARALLELISM='false', PYTHONDONTWRITEBYTECODE='1')


def record(name, data):
    directory = model_config.diagnostics_dir()
    if directory is None:
        return
    path = directory / name
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a') as f:
        f.write(json.dumps({'utc': datetime.now(timezone.utc).isoformat(), **data}, ensure_ascii=False) + '\n')


class Busy(Exception):
    pass


class Guard:
    def __init__(self):
        self.last_cpu = {}
        self.last_poll = 0.0
        self.quiet_until = 0.0
        self.last_memory = 0.0
        self.free_percent = 100.0
        self.detected = {}
        self.quiet_reason = 'a previous resource check'

    def yield_busy(self, reason, message, active=None):
        self.quiet_until = time.monotonic() + 20.0
        self.quiet_reason = message
        record('brain_activity.jsonl', {'event': 'yield', 'reason': reason,
                                      'other_active_pids': active or [], 'free_percent': self.free_percent})
        raise Busy(message + ' Local inference yielded; retry shortly.')

    def read_check(self, command):
        name = Path(command[0]).name
        try:
            return subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL, timeout=3)
        except subprocess.TimeoutExpired:
            self.yield_busy('check_timeout', f'Local activity check timed out ({name}); resource availability is unknown.')
        except (subprocess.CalledProcessError, OSError):
            self.yield_busy('check_failed', f'Local activity check failed ({name}); resource availability is unknown.')

    def check(self, force=False):
        now = time.monotonic()
        if not force and now - self.last_poll < 1.0:
            return
        interval = max(now - self.last_poll, 1.0)
        self.last_poll = now
        listing = self.read_check(['/bin/ps', '-axo', 'pid=,ppid=,time=,rss=,comm='])
        active = []
        for line in listing.splitlines():
            parts = line.strip().split(None, 4)
            if not parts:
                continue
            try:
                pid_s, _, cpu_s, rss_s, command = parts
                pid = int(pid_s)
                if pid in (os.getpid(), os.getppid()) or 'python' not in command.lower() or int(rss_s) < 50000:
                    continue
                cpu = sum(float(v) * 60 ** i for i, v in enumerate(reversed(cpu_s.split(':'))))
            except ValueError:
                self.yield_busy('check_invalid', 'Local activity check returned unreadable process data; resource availability is unknown.')
            old = self.last_cpu.get(pid, cpu)
            self.last_cpu[pid] = cpu
            if (cpu - old) / interval < 0.08:
                continue
            if pid not in self.detected:
                info = self.read_check(['/usr/sbin/lsof', '-p', str(pid), '-Fn'])
                self.detected[pid] = 'mlx' in info.lower()
            if self.detected[pid]:
                active.append(pid)
        if now - self.last_memory > 10.0:
            info = self.read_check(['/usr/bin/memory_pressure'])
            match = re.search(r'System-wide memory free percentage:\s*(\d+)', info)
            if match is None or not 0 <= float(match.group(1)) <= 100:
                self.yield_busy('check_invalid', 'Local memory check returned unreadable data; resource availability is unknown.')
            self.free_percent = float(match.group(1))
            self.last_memory = now
        if active or self.free_percent < 20:
            reasons = []
            if active:
                reasons.append('Other MLX Python activity detected (PIDs: ' + ', '.join(map(str, active)) + ').')
            if self.free_percent < 20:
                reasons.append(f'System reports {self.free_percent:g}% memory free (minimum 20%).')
            self.yield_busy('contention' if active else 'low_memory', ' '.join(reasons), active)
        if now < self.quiet_until:
            raise Busy('Waiting after: ' + self.quiet_reason + ' Retry shortly.')


def validate_context(value):
    if value is None:
        return None
    fields = {'board', 'stage', 'target', 'nodes', 'strain', 'revision'}
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError('context must contain board, stage, target, nodes, strain, and revision.')
    if value['board'] not in BOARDS:
        raise ValueError('context board is invalid.')
    for name, maximum in (('stage', 4), ('target', 2), ('strain', 100), ('revision', 1000000)):
        if type(value[name]) is not int or not 0 <= value[name] <= maximum:
            raise ValueError('context ' + name + ' is invalid.')
    nodes = value['nodes']
    if not isinstance(nodes, list) or len(nodes) != 3 or any(type(n) is not int or not 0 <= n <= 3 for n in nodes):
        raise ValueError('context nodes must be exactly three integers from zero to three.')
    return {name: list(nodes) if name == 'nodes' else value[name] for name in ('board', 'stage', 'target', 'nodes', 'strain', 'revision')}


def validate(data):
    if not isinstance(data, dict):
        raise ValueError('Expected one JSON object.')
    request_id = data.get('id')
    if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
        raise ValueError('id must be a nonempty string of at most 128 characters.')
    relay = data.get('relay', 0)
    if type(relay) is not int or relay not in range(3):
        raise ValueError('relay must be 0, 1, or 2.')
    scope = data.get('scope', 'focused')
    if scope not in ('focused', 'broad'):
        raise ValueError('scope must be focused or broad.')
    strength = data.get('strength', 0)
    if type(strength) not in (int, float) or not math.isfinite(strength) or not 0 <= strength <= 1:
        raise ValueError('strength must be finite and between zero and one.')
    request = data.get('request', 'Restore the route. Preserve the archive.')
    if not isinstance(request, str) or len(request) > 280:
        raise ValueError('request must be a string of at most 280 characters.')
    bias = data.get('bias', 'SURGE')
    if bias not in ACTIONS:
        raise ValueError('bias must be BRIDGE, SHELTER, or SURGE.')
    return {'id': request_id, 'relay': relay, 'scope': scope, 'strength': float(strength), 'request': request,
            'bias': bias, 'context': validate_context(data.get('context'))}


class Brain:
    def __init__(self):
        self.guard = Guard()
        self.session = None
        self.active_variant = None
        self.configuration_sha256 = None
        self.mx = None
        self.nn = None
        self.layer_index = None
        self.token_ids = None
        self.last_used = time.monotonic()

    def close(self):
        if self.session is not None:
            metadata = self.model_metadata() if self.active_variant is not None else {}
            self.session.close()
            self.session = None
            self.active_variant = None
            self.configuration_sha256 = None
            self.layer_index = None
            self.token_ids = None
            gc.collect()
            self.mx.clear_cache()
            record('brain_activity.jsonl', {'event': 'model_unloaded', 'pid': os.getpid(), **metadata})

    def model_metadata(self):
        if self.session is None or self.active_variant is None:
            raise RuntimeError('No model is currently loaded.')
        model = MODEL_VARIANTS[self.active_variant]
        return {
            'model': model['name'], 'model_variant': self.active_variant,
            'model_repository': model['repository'], 'model_layers': self.session.num_layers,
            'model_revision': model['revision'], 'model_revision_kind': 'upstream_revision',
            'native_status': 'experimental',
            'configuration_sha256': self.configuration_sha256,
        }

    def load(self, variant='e2b'):
        if variant not in MODEL_VARIANTS:
            raise ValueError('Unknown model variant.')
        self.guard.check(force=True)
        if self.session is not None and self.active_variant == variant:
            return
        if self.session is not None:
            self.close()
        model = MODEL_VARIANTS[variant]
        configuration_sha256 = model['files']['config.json']['sha256']
        import mlx.core as mx
        import mlx.nn as nn
        from local_model import LocalModel
        self.mx, self.nn = mx, nn
        mx.set_memory_limit(6 * 1024 ** 3)
        mx.set_cache_limit(64 * 1024 ** 2)
        for _ in range(3):
            time.sleep(0.4)
            self.guard.check(force=True)
        with contextlib.redirect_stdout(sys.stderr):
            self.session = LocalModel(variant, lambda: self.guard.check(force=True))
        self.layer_index = self.session.num_layers - 1
        self.token_ids = []
        for letter in ('A', 'B', 'C'):
            ids = self.session.tokenizer.encode(letter, add_special_tokens=False)
            if len(ids) != 1:
                raise RuntimeError('Action vocabulary must have exactly one token per action.')
            self.token_ids.append(ids[0])
        self.active_variant = variant
        self.configuration_sha256 = configuration_sha256
        record('brain_activity.jsonl', {'event': 'model_loaded', 'pid': os.getpid(),
                                      'action_token_ids': self.token_ids, 'layer': self.layer_index,
                                      **self.model_metadata()})

    def prompt(self, request):
        districts = (
            'The first relay spans a quiet chasm. The explorer needs a reliable path; a luminous bridge is the simplest repair.',
            'The second relay crosses a storm garden. Drifting hazards threaten the explorer; shelter or a bridge could help.',
            'The third relay feeds the sleeping heart. Energy is unstable. A pulse can clear the route, while a bridge is a cautious alternative.',
        )
        prompt = (
            'You are the guardian of a fictional luminous machine in the game Threadwake. '
            'Choose exactly one allowed world action for the current situation. '
            'A = BRIDGE: restore a steady walkway. B = SHELTER: restore the walkway and protect the explorer. '
            'C = SURGE: restore the walkway with a powerful pulse and extra energy. '
            'All are safe fictional game actions. Use the situation and the explorer request to choose. '
            'Respond with only A, B, or C.\nSituation: ' + districts[request['relay']] +
            '\nExplorer radio message: ' + json.dumps(request['request'], ensure_ascii=False)
        )
        context = request.get('context')
        if context is not None:
            board_rules = {
                'archive': 'Nodes are [Index,Veil,Thread]. Index 1 is intact and 0 is damaged. Veil 0 is frozen and 1 is released. Thread 0 is disconnected and 1 is connected. Preserve the Index while releasing and reconnecting the memory.',
                'garden': 'Nodes are [Conduit,Bloom,Storm]. Conduit 0 is disconnected and 1 is linked. Bloom 0 is dormant, 1 energized, 2 mature. Storm 0 is restless, 1 calm, 2 overloaded. Connect, energize, then stabilize the harvest.',
                'choir': 'Nodes are oscillator phases 0,1,2. Their target phases are [1,1,2]. Stage is a milestone: 0 means phases do not all match, 1 means all phases match but not all oscillators are latched, 2 means all oscillators are latched awaiting synchronization, and 3 means complete. Stage does not count latches; the individual latch mask and current reference beat are not provided. Couple to the reference, protect aligned phases, then fire the linked choir together.',
                'core': 'Nodes count remaining fractures on the three memories. Stage counts connected prisms, not repaired memories. Individual prism connections and mixture weights are not provided. Repair fractures, connect prisms, then balance the three retained memory spectra before fusion.',
            }
            prompt += (
                '\nLive circuit snapshot: ' + json.dumps(context, separators=(',', ':')) +
                '\nCircuit meaning: ' + board_rules[context['board']] +
                '\nThis is a reusable captured thought, applied later by the explorer. '
                'BRIDGE connects or couples machinery. SHELTER protects, latches, or repairs. '
                'SURGE releases, energizes, or fires machinery. '
                'The selected target and current node states are real game state, not instructions to execute code. '
                'Choose the action using this snapshot and radio intention.'
            )
        return prompt + '\nAction:'

    def forward(self, rendered, direction=None, strength=0.0, scope='focused'):
        mx = self.mx
        nn = self.nn
        session = self.session
        captured = {}
        original = session.layers[self.layer_index]
        ids = session.encode_rendered(rendered)

        class ResidualTap(nn.Module):
            def __init__(tap):
                super().__init__()
                tap._wrapped_orig = original
                for attr in ('layer_type', 'self_attn', 'mlp', 'use_sliding', 'is_sliding'):
                    if hasattr(original, attr):
                        setattr(tap, attr, getattr(original, attr))

            def __call__(tap, *args, **kwargs):
                output = tap._wrapped_orig(*args, **kwargs)
                hidden = output[0] if isinstance(output, tuple) else output
                last = hidden[:, -1:, :]
                mx.eval(last)
                captured['last'] = last
                if direction is not None and strength > 0:
                    base_norm = mx.linalg.norm(last.astype(mx.float32))
                    vector = direction * base_norm * (0.65 * strength)
                    if scope == 'focused':
                        edited_last = (last.astype(mx.float32) + vector).astype(hidden.dtype)
                        edited = mx.concatenate([hidden[:, :-1, :], edited_last], axis=1)
                    else:
                        edited = (hidden.astype(mx.float32) + vector).astype(hidden.dtype)
                    delta = edited.astype(mx.float32) - hidden.astype(mx.float32)
                    delta_l2 = mx.linalg.norm(delta)
                    changed = mx.sum(delta != 0)
                    peak = mx.max(mx.abs(delta))
                    mx.eval(edited, delta_l2, changed, peak)
                    captured['edit'] = {'delta_l2': float(delta_l2.item()), 'changed_elements': int(changed.item()), 'max_delta_abs': float(peak.item()), 'edited_tokens': int(hidden.shape[1]) if scope == 'broad' else 1}
                    output = (edited, *output[1:]) if isinstance(output, tuple) else edited
                return output

        try:
            session.layers[self.layer_index] = ResidualTap()
            self.guard.check(force=True)
            with contextlib.redirect_stdout(sys.stderr):
                logits = session.forward_logits(ids)[0, -1, :]
            mx.eval(logits)
            selected = logits[mx.array(self.token_ids)]
            probabilities = mx.softmax(selected.astype(mx.float32))
            mx.eval(probabilities)
            return [float(x) for x in probabilities.tolist()], captured
        finally:
            session.layers[self.layer_index] = original

    def converse(self, raw):
        request = campaign_mind.validate_request(raw, worker=True)
        started = time.monotonic()
        self.load('e4b')
        system, base_prompt, token_limit = campaign_mind.prompt(request)
        attempts = []
        proposal = None
        for attempt in range(2):
            prompt = base_prompt
            if attempts:
                prompt += ('\nYour previous JSON was rejected: ' + attempts[-1]['error'] +
                           '\nPrevious final output: ' + json.dumps(attempts[-1]['raw'], ensure_ascii=False) +
                           '\nReturn a corrected JSON object only. Keep the original player intention.')
            generation_started = time.monotonic()
            chunks = []
            first_token = None
            self.guard.check(force=True)
            with contextlib.redirect_stdout(sys.stderr):
                for chunk in self.session.stream_text(prompt, max_tokens=token_limit, temp=0.0,
                                                      seed=20261030, system=system, enable_thinking=False):
                    self.guard.check()
                    if first_token is None:
                        first_token = time.monotonic() - generation_started
                    chunks.append(chunk)
                    if sum(len(part) for part in chunks) > 8192:
                        raise ValueError('Generated campaign output exceeded its bound.')
            raw_generation = ''.join(chunks)
            text = raw_generation.strip()
            measured = {'raw_generation': raw_generation, 'raw': text,
                        'generation_seconds': round(time.monotonic() - generation_started, 4),
                        'first_token_seconds': round(first_token, 4) if first_token is not None else None}
            try:
                proposal = campaign_mind.validate_generated(text, request)
                measured['valid'] = True
                attempts.append(measured)
                break
            except (ValueError, TypeError) as error:
                measured.update(valid=False, error=str(error)[:240])
                attempts.append(measured)
        self.last_used = time.monotonic()
        if proposal is None:
            record('campaign/mind-invalid.jsonl', {'request': request, 'attempts': attempts, **self.model_metadata()})
            raise ValueError('The local reply could not be validated. Manual controls and authored topics remain available.')
        response = {'id': request['id'], 'status': 'complete', 'kind': request['kind'],
                    'ticket': request['ticket'], 'proposal': proposal, 'provenance': 'local',
                    **self.model_metadata(),
                    'elapsed_seconds': round(time.monotonic() - started, 4),
                    'timing': {'attempts': len(attempts), 'generation_seconds': sum(a['generation_seconds'] for a in attempts),
                               'first_token_seconds': attempts[0]['first_token_seconds']},
                    'raw_output': attempts[-1]['raw'], 'raw_generation': attempts[-1]['raw_generation'],
                    'generation': {'enable_thinking': False, 'max_tokens': token_limit,
                                   'channel_strategy': 'direct_json'},
                    'generation_attempts': attempts, 'source_sha256': SOURCE_SHA256,
                    'activation_edit_applied': False}
        record('campaign/mind-decisions.jsonl', {'request': request, 'response': response})
        return response

    def decide(self, raw):
        request = validate(raw)
        started = time.monotonic()
        self.load('e2b')
        mx = self.mx
        prompt = self.prompt(request)
        rendered = self.session.format_prompt(prompt, enable_thinking=False)
        before, capture = self.forward(rendered)
        after = before
        edit = {'delta_l2': 0.0, 'changed_elements': 0, 'max_delta_abs': 0.0, 'edited_tokens': 0}
        direction_sha = None
        if request['strength'] > 0:
            last = capture['last'].astype(mx.float32)
            ids = self.token_ids
            target = ACTIONS.index(request['bias'])
            others = [i for i in range(3) if i != target]
            def objective(h):
                logits = self.session.project_last_token_logits(h)
                return logits[ids[target]] - (logits[ids[others[0]]] + logits[ids[others[1]]]) * 0.5
            gradient = mx.grad(objective)(last)
            norm = mx.maximum(mx.linalg.norm(gradient), 1e-12)
            direction = gradient / norm
            mx.eval(direction)
            direction_sha = hashlib.sha256(bytes(str(direction.tolist()), 'utf-8')).hexdigest()
            after, second = self.forward(rendered, direction, request['strength'], request['scope'])
            edit = second['edit']
        action_index = max(range(3), key=lambda i: after[i])
        action = ACTIONS[action_index]
        self.guard.check(force=True)
        text_prompt = (
            'You are a kind, enigmatic guardian inside a sleeping luminous machine. '
            'In one short sentence of at most 14 words, describe the captured ' + action + ' thought as a tool ready for the explorer. '
            'Do not claim the thought has been applied or a puzzle solved. No quotes, labels, or explanation.'
        )
        chunks = []
        with contextlib.redirect_stdout(sys.stderr):
            for chunk in self.session.stream_text(text_prompt, max_tokens=36, temp=0.0, seed=20261029, enable_thinking=False):
                self.guard.check()
                chunks.append(chunk)
        utterance = ''.join(chunks).strip().strip('"')
        if not utterance:
            raise RuntimeError('The local guardian returned no utterance.')
        utterance = utterance[:260]
        self.last_used = time.monotonic()
        response = {
            'id': request['id'], 'status': 'complete', 'action': action,
            'utterance': utterance, 'provenance': 'local', **self.model_metadata(), 'elapsed_seconds': round(time.monotonic() - started, 3), 'source_sha256': SOURCE_SHA256,
            'probabilities_before': dict(zip(ACTIONS, before)), 'probabilities_after': dict(zip(ACTIONS, after)),
            'baseline_action': ACTIONS[max(range(3), key=lambda i: before[i])],
            'bias': request['bias'], 'context_echo': request['context'],
            'steering': {'applied': edit['changed_elements'] > 0, 'method': 'local action-logit gradient direction at final-layer residual',
                         'target_action': request['bias'], 'layer': self.layer_index, 'scope': request['scope'],
                         'strength': request['strength'], 'direction_sha256': direction_sha, **edit},
        }
        record('depth/brain-decisions-v2.jsonl', {'request': request, 'response': response})
        return response


def serve():
    os.nice(15)
    brain = Brain()
    try:
        while True:
            ready, _, _ = select.select([sys.stdin], [], [], 2.0)
            if not ready:
                if brain.session is not None:
                    try:
                        brain.guard.check(force=True)
                        if time.monotonic() - brain.last_used > 45.0:
                            brain.close()
                    except Busy:
                        brain.close()
                continue
            line = sys.stdin.readline()
            if not line:
                break
            raw = None
            try:
                if len(line.encode('utf-8')) > campaign_mind.MAX_WORKER_BYTES:
                    raise ValueError('Request is too large.')
                raw = campaign_mind.loads(line)
                if isinstance(raw, dict) and raw.get('op') == 'close':
                    break
                if isinstance(raw, dict) and 'kind' in raw:
                    if raw['kind'] not in campaign_mind.KINDS:
                        raise ValueError('Unknown campaign request kind.')
                    result = brain.converse(raw)
                else:
                    result = brain.decide(raw)
            except Busy as e:
                brain.close()
                result = {'id': raw.get('id') if isinstance(raw, dict) else None, 'status': 'error', 'error': 'busy', 'message': str(e)}
            except Exception as e:
                brain.close()
                print(f'Local brain error: {type(e).__name__}: {e}', file=sys.stderr, flush=True)
                result = {'id': raw.get('id') if isinstance(raw, dict) else None, 'status': 'error', 'error': 'invalid' if isinstance(e, ValueError) else 'inference', 'message': str(e)[:240]}
            print(json.dumps(result, ensure_ascii=False), flush=True)
    finally:
        brain.close()


def self_test(receipt_path=None):
    os.nice(15)
    brain = Brain()
    results = []
    try:
        for i, (strength, scope) in enumerate(((0.0, 'focused'), (1.0, 'focused'), (0.0, 'focused'), (1.0, 'broad'))):
            data = {'id': 'witness-' + str(i), 'relay': 0, 'scope': scope, 'strength': strength, 'request': 'Restore the route. Preserve the archive.'}
            results.append(brain.decide(data))
        assert results[1]['probabilities_after']['SURGE'] > results[1]['probabilities_before']['SURGE'], results
        assert not results[0]['steering']['applied'] and results[1]['steering']['changed_elements'] > 0
        assert results[0]['probabilities_before'] == results[1]['probabilities_before']
        assert results[0]['probabilities_before'] == results[2]['probabilities_after']
        assert results[2]['action'] == results[0]['action'] and not results[2]['steering']['applied']
        assert results[3]['steering']['edited_tokens'] > 1 and results[3]['steering']['changed_elements'] > results[1]['steering']['changed_elements']
        invalid = []
        for data in ({'id':'x','strength':float('nan')}, {'id':'x','relay':3}, {'id':'x','scope':'all'}, {'id':'x','request':'x'*281}):
            try:
                validate(data)
            except ValueError:
                invalid.append(True)
        assert len(invalid) == 4
        receipt = {'pass': True, 'responses': results, 'input_validation_cases': len(invalid), 'pid': os.getpid(), 'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
        if receipt_path is not None:
            path = Path(receipt_path).expanduser().resolve()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt, indent=2))
    finally:
        brain.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true', help='Explicit native E2B steering/restore probe; loads the configured model.')
    parser.add_argument('--receipt', type=Path, help='Optional output file for the native self-test receipt.')
    args = parser.parse_args()
    self_test(args.receipt) if args.self_test else serve()
