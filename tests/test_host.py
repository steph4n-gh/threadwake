"""Owned ephemeral HTTP hosts only. No MLX imports, GPU, downloads, or real workers."""
import contextlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from queue import Empty, Queue
import re
import socket
import subprocess
import sys
import tempfile
from threading import Thread
import time
import unittest
from unittest import mock

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server


class HostTests(unittest.TestCase):
    def setUp(self):
        self.runtime = tempfile.TemporaryDirectory()
        self.environment = mock.patch.dict(os.environ, {'THREADWAKE_DATA_DIR': str(Path(self.runtime.name) / 'runtime'), 'THREADWAKE_DIAGNOSTICS': '0'})
        self.environment.start()
        server.JOBS.clear()
        server.NATIVE_AVAILABLE = False
        server.MODE = 'authored-demo'
        server.HEALTH.update(status='demo', model=None, message='Authored demo. No local model is enabled.')
        server.WORKER = None
        self.host = server.LocalServer(('127.0.0.1', 0), server.Handler)
        self.port = self.host.server_port
        self.thread = Thread(target=self.host.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.host.shutdown()
        self.host.server_close()
        self.thread.join(timeout=2)
        server.NATIVE_AVAILABLE = False
        while True:
            try:
                server.QUEUE.get_nowait()
                server.QUEUE.task_done()
            except Empty:
                break
        server.JOBS.clear()
        self.environment.stop()
        self.runtime.cleanup()

    def request(self, method='GET', path='/api/health', body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            raw = response.read()
            return response.status, dict(response.getheaders()), raw
        finally:
            connection.close()

    def post(self, value):
        return self.request('POST', '/api/consult', json.dumps(value), {'Content-Type': 'application/json'})

    def test_demo_health_static_and_no_worker(self):
        with mock.patch.object(server.subprocess, 'Popen', side_effect=AssertionError('worker must not start')):
            status, headers, body = self.request()
            row = json.loads(body)
            self.assertEqual(status, 200)
            self.assertEqual((row['application'], row['api_version'], row['mode']), ('threadwake-public', 3, 'authored-demo'))
            self.assertFalse(row['native_available'])
            self.assertTrue(row['authored_available'])
            self.assertIsNone(row['worker_pid'])
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertEqual(self.request(path='/')[0], 200)
            self.assertEqual(self.post({'relay': 0, 'scope': 'focused'})[0], 503)
            self.assertEqual(server.QUEUE.qsize(), 0)
        self.assertFalse(any(name == 'mlx' or name.startswith('mlx.') or name == 'mlx_lm' for name in sys.modules))

    def test_foreign_host_origin_and_fetch_site_on_get_jobs_and_static(self):
        server.JOBS['private'] = {'id': 'private', 'status': 'complete', 'started': time.time(), 'result': 'private-sentinel'}
        for path in ('/', '/api/health', '/api/job/private'):
            for headers in ({'Host': 'foreign.invalid'}, {'Host': f'127.0.0.1:{self.port + 1}'},
                            {'Origin': 'https://foreign.invalid'}, {'Origin': 'null'},
                            {'Origin': f'http://localhost:{self.port}'}):
                with self.subTest(path=path, headers=headers):
                    status, _, body = self.request(path=path, headers=headers)
                    self.assertEqual(status, 403)
                    self.assertNotIn(b'private-sentinel', body)
        for site in ('cross-site', 'same-site'):
            self.assertEqual(self.request(path='/api/job/private', headers={'Sec-Fetch-Site': site})[0], 403)
        self.assertEqual(self.request(path='/api/job/private', headers={'Origin': f'http://127.0.0.1:{self.port}'})[0], 200)
        self.assertEqual(self.request(headers={'Host': f'localhost:{self.port}', 'Origin': f'http://localhost:{self.port}'})[0], 200)
        self.assertEqual(self.request('HEAD', headers={'Host': 'foreign.invalid'})[0], 403)
        self.assertEqual(self.request('POST', '/api/mind', '{}', {'Origin': 'https://foreign.invalid'})[0], 403)

    def raw(self, request):
        with socket.create_connection(('127.0.0.1', self.port), timeout=3) as stream:
            stream.sendall(request)
            return stream.recv(8192)

    def test_ambiguous_headers_body_bounds_and_absolute_targets(self):
        prefix = f'POST /api/mind HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n'.encode()
        for suffix in (b'Content-Length: 2\r\nContent-Length: 2\r\n', b'Transfer-Encoding: chunked\r\nContent-Length: 2\r\n'):
            self.assertIn(b' 400 ', self.raw(prefix + suffix + b'\r\n{}'))
        self.assertIn(b' 403 ', self.raw(f'GET /api/health HTTP/1.1\r\nHost: localhost:{self.port}\r\nHost: foreign.invalid\r\n\r\n'.encode()))
        self.assertEqual(self.request('POST', '/api/mind', '{}', {'Content-Length': '16385', 'Content-Type': 'application/json'})[0], 413)
        self.assertEqual(self.request('POST', '/api/consult', '{}', {'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request(path='http://foreign.invalid/api/health', headers={'Host': f'127.0.0.1:{self.port}'})[0], 400)

    def test_mocked_native_validation_queue_limit_without_worker(self):
        # Only permit request validation/queueing. No worker thread is created in this host.
        server.NATIVE_AVAILABLE = True
        for value in ({'relay': True, 'scope': 'focused'}, {'relay': 0, 'scope': 'focused', 'strength': float('nan')}):
            self.assertEqual(self.post(value)[0], 400)
        valid = {'relay': 0, 'scope': 'focused', 'strength': .5, 'request': 'Synthetic host test'}
        self.assertEqual([self.post(valid)[0] for _ in range(4)], [202, 202, 202, 429])
        self.assertEqual(server.QUEUE.qsize(), 3)
        self.assertEqual(len(server.JOBS), 3)
        self.assertIsNone(server.WORKER)

    def test_header_and_body_trickle_have_absolute_production_deadline(self):
        server.NATIVE_AVAILABLE = True
        deadline = server.REQUEST_DEADLINE_SECONDS
        self.assertEqual(deadline, 10)
        streams = [socket.create_connection(('127.0.0.1', self.port), timeout=2) for _ in range(2)]
        start = time.monotonic()
        try:
            streams[0].sendall(f'GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\nX-Slow: '.encode())
            streams[1].sendall(f'POST /api/mind HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n'.encode())
            while time.monotonic() - start < deadline + .5:
                for stream in streams:
                    with contextlib.suppress(BrokenPipeError, ConnectionResetError):
                        stream.sendall(b'x')
                time.sleep(.2)
            for stream in streams:
                stream.settimeout(1)
                try:
                    self.assertEqual(stream.recv(8192), b'')
                except ConnectionResetError:
                    pass
            self.assertLess(time.monotonic() - start, deadline + 2)
            self.assertEqual(server.QUEUE.qsize(), 0)
        finally:
            for stream in streams:
                stream.close()

    def test_reuse_requires_public_identity_source_and_mode(self):
        self.assertTrue(server.verified_existing(self.port))
        self.assertFalse(server.verified_existing(self.port, local_model=True))

        class OtherHealth(BaseHTTPRequestHandler):
            row = {'status': 'ready'}
            slow = False

            def log_message(self, *_):
                pass

            def do_GET(self):
                raw = json.dumps(self.row).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                if self.slow:
                    try:
                        for byte in raw:
                            self.wfile.write(bytes([byte]))
                            self.wfile.flush()
                            time.sleep(.2)
                    except ConnectionError:
                        pass
                else:
                    self.wfile.write(raw)

        other = ThreadingHTTPServer(('127.0.0.1', 0), OtherHealth)
        other.daemon_threads = True
        thread = Thread(target=other.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        thread.start()
        try:
            self.assertFalse(server.verified_existing(other.server_port))
            OtherHealth.row = {'application': 'threadwake-public', 'api_version': 3, 'mode': 'authored-demo', 'source_sha256': {'server.py': 'wrong'}}
            self.assertFalse(server.verified_existing(other.server_port))
            OtherHealth.row['source_sha256'] = {**server.SOURCE_SHA256, 'brain.py': 'different-backend'}
            OtherHealth.row['native_available'] = False
            self.assertFalse(server.verified_existing(other.server_port))
            OtherHealth.row['source_sha256'] = None
            self.assertFalse(server.verified_existing(other.server_port))
            OtherHealth.slow = True
            start = time.monotonic()
            self.assertFalse(server.verified_existing(other.server_port))
            self.assertLess(time.monotonic() - start, 3.5)
            OtherHealth.slow = False
            result = subprocess.run([sys.executable, '-B', str(ROOT / 'server.py'), '--port', str(other.server_port), '--reuse'], capture_output=True, text=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('unverified process', result.stderr)
            connection = http.client.HTTPConnection('127.0.0.1', other.server_port, timeout=1)
            connection.request('GET', '/api/health')
            self.assertEqual(connection.getresponse().status, 200)
            connection.close()
        finally:
            other.shutdown()
            other.server_close()
            thread.join(timeout=2)
        result = subprocess.run([sys.executable, '-B', str(ROOT / 'server.py'), '--port', str(self.port), '--reuse'], capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Reusing verified', result.stdout)

    def test_actual_stale_local_mode_reuse_requires_restart_and_leaves_host_running(self):
        server.MODE = 'local-model'
        server.NATIVE_AVAILABLE = False
        script = (
            'import sys\nfrom unittest.mock import patch\nimport server\n'
            "with patch.object(server.model_config, 'native_status', return_value={'available': True, 'message': 'Synthetic setup change'}):\n"
            "    raise SystemExit(server.main(['--local-model', '--reuse', '--port', sys.argv[1]]))\n"
        )
        result = subprocess.run([sys.executable, '-B', '-c', script, str(self.port)], cwd=ROOT,
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('stale setup availability', result.stderr)
        self.assertIn('Stop and restart', result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        status, _, raw = self.request()
        row = json.loads(raw)
        self.assertEqual(status, 200)
        self.assertEqual(row['mode'], 'local-model')
        self.assertFalse(row['native_available'])
        self.assertIsNone(row['worker_pid'])
        self.assertEqual(row['pending'], 0)

    def test_local_model_unavailable_preflight_does_not_start_worker(self):
        host = mock.Mock(server_port=12345)
        host.serve_forever.side_effect = KeyboardInterrupt
        with mock.patch.object(server.model_config, 'native_status', return_value={'available': False, 'message': 'Synthetic unavailable preflight'}), \
             mock.patch.object(server, 'LocalServer', return_value=host), \
             mock.patch.object(server, 'Thread', side_effect=AssertionError('no worker thread')):
            self.assertEqual(server.main(['--local-model', '--port', '0']), 0)
        self.assertEqual(server.MODE, 'local-model')
        self.assertFalse(server.NATIVE_AVAILABLE)
        self.assertEqual(server.HEALTH['status'], 'unavailable')
        self.assertIsNone(server.WORKER)

    def test_server_class_cannot_bind_public_address(self):
        with self.assertRaisesRegex(ValueError, 'loopback'):
            server.LocalServer(('0.0.0.0', 0), server.Handler)

    def demo_cli_health(self, env):
        process = subprocess.Popen([sys.executable, '-B', str(ROOT / 'server.py'), '--port', '0'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        lines = Queue()
        Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True).start()
        try:
            line = lines.get(timeout=5)
            match = re.search(r'http://127\.0\.0\.1:(\d+)/', line)
            self.assertIsNotNone(match, line)
            self.assertIn('authored-demo', line)
            connection = http.client.HTTPConnection('127.0.0.1', int(match[1]), timeout=2)
            connection.request('GET', '/api/health')
            row = json.loads(connection.getresponse().read())
            connection.close()
            self.assertFalse(row['native_available'])
            self.assertIsNone(row['worker_pid'])
            return row
        finally:
            process.terminate()
            process.communicate(timeout=5)

    def test_real_demo_cli_needs_no_runtime_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            data = Path(temporary) / 'runtime'
            env = {**os.environ, 'THREADWAKE_DATA_DIR': str(data), 'THREADWAKE_DIAGNOSTICS': '0', 'PYTHONDONTWRITEBYTECODE': '1'}
            self.assertEqual(self.demo_cli_health(env)['mode'], 'authored-demo')
            self.assertFalse(data.exists())

    def test_real_demo_cli_serves_with_invalid_cache_path_and_creates_no_user_dirs(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            blocker = parent / 'not-a-directory'
            blocker.write_text('unchanged sentinel')
            env = {**os.environ, 'THREADWAKE_DATA_DIR': str(blocker / 'runtime'), 'THREADWAKE_DIAGNOSTICS': '0',
                   'HOME': str(parent / 'missing-home'), 'LOCALAPPDATA': str(parent / 'missing-appdata'),
                   'XDG_DATA_HOME': str(parent / 'missing-xdg'), 'PYTHONDONTWRITEBYTECODE': '1'}
            self.assertEqual(self.demo_cli_health(env)['mode'], 'authored-demo')
            self.assertEqual(set(parent.iterdir()), {blocker})
            self.assertEqual(blocker.read_text(), 'unchanged sentinel')

    def test_required_native_or_diagnostic_cache_path_failure_is_clean_cli_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            blocker = Path(temporary) / 'not-a-directory'
            blocker.write_text('unchanged sentinel')
            for args, diagnostics in ((['--local-model'], '0'), ([], '1')):
                with self.subTest(args=args, diagnostics=diagnostics):
                    env = {**os.environ, 'THREADWAKE_DATA_DIR': str(blocker / 'runtime'), 'THREADWAKE_DIAGNOSTICS': diagnostics}
                    result = subprocess.run([sys.executable, '-B', str(ROOT / 'server.py'), '--port', '0', *args],
                                            capture_output=True, text=True, timeout=5, env=env)
                    self.assertEqual(result.returncode, 1)
                    self.assertIn('Cannot use Threadwake runtime data:', result.stderr)
                    self.assertNotIn('Traceback', result.stderr)
                    self.assertEqual(blocker.read_text(), 'unchanged sentinel')


if __name__ == '__main__':
    unittest.main()
