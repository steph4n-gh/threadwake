"""Portable loopback host: authored demo by default; local inference is explicit."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from socketserver import TCPServer
from pathlib import Path
from threading import Thread, Lock, Timer
from queue import Queue, Empty, Full
from urllib.parse import urlsplit
import argparse
import hashlib
import http.client
import json
import math
import socket
import subprocess
import sys
import time
import uuid
import webbrowser

from brain import ACTIONS, validate_context
import campaign_mind
import model_config

ROOT = Path(__file__).resolve().parent
APPLICATION = 'threadwake-public'
DEFAULT_PORT = 8769
SOURCE_SHA256 = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                 for name in ('server.py', 'brain.py', 'campaign_mind.py', 'model_config.py')}
JOBS = {}
LOCK = Lock()
QUEUE = Queue(maxsize=3)
WORKER = None
OUTPUT = None
NATIVE_AVAILABLE = False
MODE = 'authored-demo'
HEALTH = {'status': 'demo', 'model': None, 'message': 'Authored demo. No local model is enabled.'}
REQUEST_DEADLINE_SECONDS = 10
WORKER_TIMEOUT_SECONDS = 120
TERMINAL_JOB_LIMIT = 64
JOB_RETENTION_SECONDS = 30 * 60


def prune_jobs(now=None):
    now = time.time() if now is None else now
    terminal = [(ident, row) for ident, row in JOBS.items() if row['status'] in ('complete', 'error')]
    expired = {ident for ident, row in terminal if now - row.get('finished', row['started']) > JOB_RETENTION_SECONDS}
    remaining = sorted(((ident, row) for ident, row in terminal if ident not in expired),
                       key=lambda pair: pair[1].get('finished', pair[1]['started']))
    expired.update(ident for ident, _ in remaining[:-TERMINAL_JOB_LIMIT])
    for ident in expired:
        JOBS.pop(ident, None)


def stop_worker():
    if WORKER is not None and WORKER.poll() is None:
        WORKER.terminate()
        try:
            WORKER.wait(timeout=3)
        except subprocess.TimeoutExpired:
            WORKER.kill()
            WORKER.wait()


def work():
    global WORKER, OUTPUT
    while True:
        job_id, payload = QUEUE.get()
        try:
            with LOCK:
                JOBS[job_id]['status'] = 'working'
                HEALTH.update(status='thinking', message='Considering the conversation or work order.' if payload.get('kind') in campaign_mind.KINDS else 'Reading the relay signal.')
            if WORKER is None or WORKER.poll() is not None:
                directory = model_config.diagnostics_dir()
                log = (directory / 'brain-worker.log').open('a') if directory else None
                try:
                    WORKER = subprocess.Popen([sys.executable, '-B', '-u', str(ROOT / 'brain.py')],
                                              stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                              stderr=log if log else subprocess.DEVNULL,
                                              text=True, bufsize=1, cwd=ROOT)
                finally:
                    if log:
                        log.close()
                OUTPUT = Queue()

                def read_output(process, output):
                    for line in process.stdout:
                        output.put(line)
                    output.put(None)

                Thread(target=read_output, args=(WORKER, OUTPUT), daemon=True).start()
            WORKER.stdin.write(json.dumps({'id': job_id, **payload}, ensure_ascii=False) + '\n')
            WORKER.stdin.flush()
            result = None
            deadline = time.monotonic() + WORKER_TIMEOUT_SECONDS
            while time.monotonic() < deadline:
                try:
                    line = OUTPUT.get(timeout=max(.01, deadline - time.monotonic()))
                except Empty:
                    break
                if line is None:
                    break
                try:
                    row = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if isinstance(row, dict) and row.get('id') == job_id:
                    result = row
                    break
            if not result:
                stop_worker()
                raise RuntimeError('The local worker stopped before returning a decision.')
            valid = (campaign_mind.valid_result(result, payload) if payload.get('kind') in campaign_mind.KINDS else
                     result.get('status') == 'complete' and result.get('action') in ACTIONS and result.get('provenance') == 'local')
            with LOCK:
                JOBS[job_id].update(status='complete' if valid else 'error', result=result, finished=time.time())
                prune_jobs()
                HEALTH.update(status='ready' if valid or result.get('error') == 'invalid' else 'busy' if result.get('error') == 'busy' else 'error',
                              message='Local decision received.' if valid else str(result.get('message', result.get('error', 'Local model could not answer.'))))
                if valid:
                    HEALTH.update(model=result.get('model', 'Gemma · local'), model_variant=result.get('model_variant'))
            directory = model_config.diagnostics_dir()
            if directory:
                with (directory / 'decisions.jsonl').open('a') as stream:
                    stream.write(json.dumps({'utc': time.time(), 'job_id': job_id, 'input': payload, 'result': result}) + '\n')
        except Exception as exc:
            with LOCK:
                JOBS[job_id].update(status='error', message=str(exc), finished=time.time())
                prune_jobs()
                HEALTH.update(status='error', message='The local model could not answer; authored topics and manual controls remain available.')
        finally:
            QUEUE.task_done()


def consult_payload(data):
    if not isinstance(data, dict):
        raise ValueError('Expected an object.')
    if type(data.get('relay')) is not int or data['relay'] not in range(3):
        raise ValueError('Invalid relay.')
    if data.get('scope') not in ('focused', 'broad'):
        raise ValueError('Invalid scope.')
    raw_strength = data.get('strength', 0)
    if type(raw_strength) not in (int, float) or not math.isfinite(raw_strength) or not 0 <= raw_strength <= 1:
        raise ValueError('Invalid strength.')
    request = data.get('request', '')
    if not isinstance(request, str) or len(request) > 240:
        raise ValueError('Invalid request.')
    bias = data.get('bias', 'SURGE')
    if bias not in ACTIONS:
        raise ValueError('Invalid action bias.')
    return {'relay': data['relay'], 'scope': data['scope'], 'strength': float(raw_strength),
            'request': request, 'bias': bias, 'context': validate_context(data.get('context'))}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'web'), **kwargs)

    def log_message(self, *_):
        pass

    def handle(self):
        self.request_deadline = time.monotonic() + REQUEST_DEADLINE_SECONDS
        self.connection.settimeout(REQUEST_DEADLINE_SECONDS)

        def expire():
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

        timer = Timer(REQUEST_DEADLINE_SECONDS, expire)
        timer.daemon = True
        timer.start()
        try:
            super().handle()
        except (ConnectionError, TimeoutError):
            pass
        finally:
            timer.cancel()

    def parse_request(self):
        if not super().parse_request():
            return False
        if time.monotonic() >= self.request_deadline:
            return False
        hosts = self.headers.get_all('Host', [])
        port = self.server.server_port
        allowed_hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
        if port == 80:
            allowed_hosts.update(('127.0.0.1', 'localhost'))
        if len(hosts) != 1 or hosts[0].lower() not in allowed_hosts:
            self.reply({'error': 'Loopback host required.'}, 403)
            return False
        origins = self.headers.get_all('Origin', [])
        if len(origins) > 1 or (origins and origins[0].lower() != 'http://' + hosts[0].lower()):
            self.reply({'error': 'Same-origin requests only.'}, 403)
            return False
        try:
            parsed = urlsplit(self.path)
        except ValueError:
            self.reply({'error': 'Invalid request target.'}, 400)
            return False
        if parsed.scheme or parsed.netloc or self.path.startswith('//'):
            self.reply({'error': 'Origin-form request target required.'}, 400)
            return False
        if parsed.path.startswith('/api/') and self.headers.get('Sec-Fetch-Site', '') not in ('', 'same-origin', 'none'):
            self.reply({'error': 'Same-origin API requests only.'}, 403)
            return False
        return True

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def reply(self, obj, status=200):
        raw = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(raw)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/health':
            with LOCK:
                return self.reply({**HEALTH, 'application': APPLICATION, 'api_version': 3,
                                   'mode': MODE, 'native_available': NATIVE_AVAILABLE, 'authored_available': True,
                                   'source_sha256': SOURCE_SHA256, 'pending': QUEUE.qsize(),
                                   'worker_pid': WORKER.pid if WORKER and WORKER.poll() is None else None})
        if path.startswith('/api/job/'):
            with LOCK:
                prune_jobs()
                job = JOBS.get(path.rsplit('/', 1)[-1])
                return self.reply(dict(job) if job else {'status': 'missing'}, 200 if job else 404)
        if path.startswith('/api/'):
            return self.reply({'error': 'Unknown API'}, 404)
        super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path.startswith('/api/'):
            return self.reply({'error': 'Use GET for this API.'}, 405)
        super().do_HEAD()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ('/api/consult', '/api/mind'):
            return self.reply({'error': 'Unknown API'}, 404)
        lengths = self.headers.get_all('Content-Length', [])
        if self.headers.get('Transfer-Encoding') or len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
            return self.reply({'error': 'One bounded Content-Length is required.'}, 400)
        maximum = campaign_mind.MAX_REQUEST_BYTES if path == '/api/mind' else 4096
        if len(lengths[0]) > 8 or not 1 <= int(lengths[0]) <= maximum:
            return self.reply({'error': 'Request body is too large or empty.'}, 413)
        if self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'application/json':
            return self.reply({'error': 'Content-Type must be application/json.'}, 415)
        if not NATIVE_AVAILABLE:
            return self.reply({'error': 'Native inference is not enabled. Use authored demo controls, or configure explicit --local-model mode.',
                               'mode': MODE, 'native_available': False}, 503)
        try:
            size = int(lengths[0])
            raw = self.rfile.read(size)
            if len(raw) != size or time.monotonic() >= self.request_deadline:
                return self.reply({'error': 'Request body deadline expired.'}, 408)
            data = campaign_mind.loads(raw)
            payload = campaign_mind.validate_request(data) if path == '/api/mind' else consult_payload(data)
            job_id = uuid.uuid4().hex
            with LOCK:
                prune_jobs()
                JOBS[job_id] = {'id': job_id, 'status': 'queued', 'started': time.time()}
                try:
                    QUEUE.put_nowait((job_id, payload))
                except Full:
                    JOBS.pop(job_id, None)
                    return self.reply({'error': 'The local intelligence is occupied. Try again shortly.'}, 429)
            self.reply({'id': job_id, 'status': 'queued'}, 202)
        except (ValueError, TypeError, UnicodeError) as exc:
            self.reply({'error': str(exc)}, 400)
        except (TimeoutError, OSError):
            self.close_connection = True


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):
        if self.server_address[0] != '127.0.0.1':
            raise ValueError('Only numeric IPv4 loopback binding is supported.')
        TCPServer.server_bind(self)
        self.server_name = 'localhost'
        self.server_port = self.server_address[1]


def verified_existing(port, local_model=False, native_available=False):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
    timer = None
    try:
        connection.connect()
        stream = connection.sock

        def expire():
            try:
                stream.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

        timer = Timer(2, expire)
        timer.daemon = True
        timer.start()
        connection.request('GET', '/api/health')
        response = connection.getresponse()
        raw = response.read(16385)
        if response.status != 200 or len(raw) > 16384:
            return False
        row = json.loads(raw)
        if not (isinstance(row, dict) and row.get('application') == APPLICATION and row.get('api_version') == 3
                and row.get('mode') == ('local-model' if local_model else 'authored-demo')
                and row.get('source_sha256') == SOURCE_SHA256 and type(row.get('native_available')) is bool):
            return False
        if local_model and row['native_available'] != native_available:
            raise RuntimeError('The existing Threadwake local-model host has stale setup availability. Stop and restart that host to use the current model/dependency setup; it has been left running.')
        return row['native_available'] == native_available
    except (OSError, ValueError, http.client.HTTPException):
        return False
    finally:
        if timer:
            timer.cancel()
        connection.close()


def main(argv=None):
    global MODE, NATIVE_AVAILABLE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=DEFAULT_PORT)
    parser.add_argument('--local-model', action='store_true', help='Explicitly enable configured, experimental local inference; never downloads models.')
    parser.add_argument('--open-browser', action='store_true', help='Open the local game after binding.')
    parser.add_argument('--reuse', action='store_true', help='Reuse only an exact public host identity/version and matching mode.')
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error('--port must be between 0 and 65535')
    MODE = 'local-model' if args.local_model else 'authored-demo'
    NATIVE_AVAILABLE = False
    try:
        if args.local_model:
            model_config.data_dir()
            configured = model_config.native_status()
            NATIVE_AVAILABLE = configured['available']
            HEALTH.update(status='ready' if NATIVE_AVAILABLE else 'unavailable', message=configured['message'], model='Gemma · local (not loaded)' if NATIVE_AVAILABLE else None)
        model_config.diagnostics_dir()
    except (OSError, ValueError) as exc:
        print(f'Cannot use Threadwake runtime data: {exc}', file=sys.stderr)
        return 1
    try:
        if args.reuse and args.port and verified_existing(args.port, args.local_model, NATIVE_AVAILABLE):
            if args.open_browser:
                webbrowser.open(f'http://127.0.0.1:{args.port}/')
            print(f'Reusing verified Threadwake public host at http://127.0.0.1:{args.port}/', flush=True)
            return 0
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    try:
        server = LocalServer(('127.0.0.1', args.port), Handler)
    except OSError as exc:
        print(f'Cannot bind Threadwake public host: {exc}. An unverified process will not be reused or stopped.', file=sys.stderr)
        return 1
    if NATIVE_AVAILABLE:
        Thread(target=work, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    print(f'Threadwake public {MODE} at {url}', flush=True)
    if args.open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        stop_worker()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
