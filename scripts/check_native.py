"""One explicit, bounded native probe using the public worker and pinned models.

Real inference on small authored scenarios, not a full-game or performance test.
The ordinary worker's contention/memory guard remains enabled. No retries of the
probe are made; E4B retains its normal single schema-repair attempt.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import campaign_mind
import model_config


def requests():
    capture = {'id': 'native-baseline', 'relay': 0, 'scope': 'focused', 'strength': 0,
               'request': 'Restore the route. Preserve the archive.', 'bias': 'SURGE'}
    ticket = {'epoch': 'native-probe', 'nonce': 1, 'revision': 1, 'mission': 1, 'subject': 'dock_console'}
    work = {'id': 'native-work-order', 'kind': 'work_order',
            'text': 'Connect only the lift power supply to service power. Do not start or move anything.',
            'ticket': ticket, 'scene': {'place': 'Lower Dock', 'objective': 'Prepare the lift supply.',
            'facts': [], 'handles': [{'id': 'power_route', 'label': 'Lift power supply', 'op': 'route',
                'current': 'off', 'values': [{'id': 'off', 'label': 'Disconnected'},
                                           {'id': 'service', 'label': 'Service power'}]}],
            'triggers': [], 'conditions': []}}
    record = {'id': 'native-record-match', 'kind': 'conversation',
              'text': 'What happened to the freight?', 'ticket': {**ticket, 'nonce': 2, 'subject': 'marin'},
              'scene': {'person': {'id': 'marin', 'name': 'Marin', 'voice': 'A practical courier.'},
              'place': 'The Refuge', 'objective': 'Review the rescue record.',
              'facts': [{'id': 'freight_lost', 'text': 'The freight was released into the water before the passengers were raised. The passengers arrived safely; the cargo was lost.'},
                        {'id': 'heat_saved', 'text': 'No reserve heat cell was spent. Three heat cells remain.'}],
              'incidents': [], 'history': [], 'terms': []}}
    campaign_mind.validate_request(work, worker=True)
    campaign_mind.validate_request(record, worker=True)
    return capture, work, record


def source_hashes():
    names = ('brain.py', 'campaign_mind.py', 'local_model.py', 'model_config.py', 'models.json', 'uv.lock')
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in names}


def check_metadata(response, variant, hashes):
    assert response['status'] == 'complete', response
    assert response['provenance'] == 'local'
    assert response['model_variant'] == variant
    assert response['model_revision'] == model_config.MANIFEST[variant]['revision']
    assert response['source_sha256'] == hashes, 'Backend changed during the probe.'


def check_probabilities(response):
    for key in ('probabilities_before', 'probabilities_after'):
        values = response[key]
        assert set(values) == {'BRIDGE', 'SHELTER', 'SURGE'}
        assert all(math.isfinite(p) and 0 <= p <= 1 for p in values.values())
        assert abs(sum(values.values()) - 1) < 1e-5


def run(receipt_path, timeout):
    destination = receipt_path.expanduser().resolve()
    if destination == ROOT or ROOT in destination.parents:
        raise ValueError('Native receipts must be outside the public checkout.')
    if destination.exists() or destination.with_suffix('.stderr.log').exists():
        raise ValueError('Use a new receipt path; prior trials are never overwritten.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    deadline = started + timeout
    report = {'pass': False, 'started_utc': datetime.now(timezone.utc).isoformat(),
              'scope': 'Real pinned-model outputs on small authored scenarios; not full-game qualification.',
              'guard_enabled': True, 'timeout_seconds': timeout, 'transcript': [],
              'source_sha256': source_hashes(),
              'probe_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    worker = None
    pending = b''
    try:
        with destination.with_suffix('.stderr.log').open('x') as stderr:
            worker = subprocess.Popen([sys.executable, '-B', str(ROOT / 'brain.py')], cwd=ROOT,
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr,
                                      start_new_session=True)
            report['worker_pid'] = worker.pid
            os.set_blocking(worker.stdout.fileno(), False)

            def ask(request):
                nonlocal pending
                entry = {'request': request, 'started_seconds': round(time.monotonic() - started, 3)}
                report['transcript'].append(entry)
                worker.stdin.write((json.dumps(request) + '\n').encode())
                worker.stdin.flush()
                while b'\n' not in pending:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError('Native probe total deadline exceeded.')
                    if not select.select([worker.stdout], [], [], remaining)[0]:
                        raise TimeoutError('Native probe total deadline exceeded.')
                    chunk = os.read(worker.stdout.fileno(), 65536)
                    if not chunk:
                        raise RuntimeError(f'Worker ended before its response (exit {worker.poll()}).')
                    pending += chunk
                    if len(pending) > 512 * 1024:
                        raise RuntimeError('Worker response exceeded the probe bound.')
                line, pending = pending.split(b'\n', 1)
                response = json.loads(line)
                entry.update(response=response, completed_seconds=round(time.monotonic() - started, 3))
                assert response.get('id') == request['id'], 'Worker returned a mismatched request ID.'
                return response

            baseline_request, work_request, record_request = requests()
            baseline = ask(baseline_request)
            check_metadata(baseline, 'e2b', report['source_sha256'])
            check_probabilities(baseline)
            # This choice is fixed by rule before editing: steer the least likely action.
            target = min(baseline['probabilities_before'], key=baseline['probabilities_before'].get)
            report['target_rule'] = 'Least probable baseline action, first in returned action order on ties.'
            report['target_action'] = target
            edited = ask({**baseline_request, 'id': 'native-edited', 'bias': target, 'strength': 1})
            check_metadata(edited, 'e2b', report['source_sha256'])
            check_probabilities(edited)
            restored = ask({**baseline_request, 'id': 'native-restored', 'bias': target})
            check_metadata(restored, 'e2b', report['source_sha256'])
            check_probabilities(restored)
            assert not baseline['steering']['applied'] and not restored['steering']['applied']
            assert edited['steering']['applied'] and edited['steering']['changed_elements'] > 0
            assert edited['steering']['delta_l2'] > 0 and edited['steering']['edited_tokens'] == 1
            for action in baseline['probabilities_before']:
                assert abs(baseline['probabilities_before'][action] - edited['probabilities_before'][action]) < 1e-6
                assert abs(baseline['probabilities_before'][action] - restored['probabilities_after'][action]) < 1e-6
            assert restored['action'] == baseline['action']
            assert edited['probabilities_after'][target] > edited['probabilities_before'][target]
            report['action_changed'] = baseline['action'] != edited['action']

            work = ask(work_request)
            check_metadata(work, 'e4b', report['source_sha256'])
            assert campaign_mind.valid_result(work, campaign_mind.validate_request(work_request, worker=True))
            assert not work['activation_edit_applied']
            assert work['proposal']['status'] == 'ready'
            assert work['proposal']['operations'] == [{'op': 'route', 'handle': 'power_route', 'value': 'service'}]
            record = ask(record_request)
            check_metadata(record, 'e4b', report['source_sha256'])
            assert campaign_mind.valid_result(record, campaign_mind.validate_request(record_request, worker=True))
            assert not record['activation_edit_applied']
            assert record['proposal'] == {'cited_facts': ['freight_lost'], 'proposal': None}
            worker.stdin.write(b'{"op":"close"}\n')
            worker.stdin.flush()
            worker.wait(timeout=max(.01, deadline - time.monotonic()))
            assert worker.returncode == 0
            assert source_hashes() == report['source_sha256'], 'Backend changed during the probe.'
            report['pass'] = True
    except Exception as error:
        report['failure'] = {'type': type(error).__name__, 'message': str(error)[:2000]}
    finally:
        if worker is not None:
            if worker.poll() is None:
                try:
                    os.killpg(worker.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    worker.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(worker.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    worker.wait(timeout=5)
            report['worker_exit_code'] = worker.returncode
            for pipe in (worker.stdin, worker.stdout):
                try:
                    pipe.close()
                except BrokenPipeError:
                    pass
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        destination.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'pass': report['pass'], 'receipt': str(destination),
                      'elapsed_seconds': report['elapsed_seconds'], 'failure': report.get('failure')}, indent=2))
    return report['pass']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt', type=Path)
    parser.add_argument('--timeout', type=int, default=300)
    parser.add_argument('--show-plan', action='store_true', help='Print authored requests without starting the worker.')
    args = parser.parse_args()
    if args.show_plan:
        print(json.dumps(requests(), indent=2))
    elif args.receipt is None or not 1 <= args.timeout <= 600:
        parser.error('Supply a new --receipt outside the checkout and --timeout from 1 to 600 seconds.')
    else:
        sys.exit(0 if run(args.receipt, args.timeout) else 1)
