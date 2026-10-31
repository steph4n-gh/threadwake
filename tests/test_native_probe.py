"""Probe lifecycle tests with toy subprocesses; no native model outputs."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_probe', ROOT / 'scripts/check_native.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ProbeTests(unittest.TestCase):
    def test_show_plan_starts_no_worker(self):
        with patch.object(probe.subprocess, 'Popen', side_effect=AssertionError('no worker')):
            capture, work, record = probe.requests()
        self.assertEqual(capture['strength'], 0)
        self.assertEqual(work['kind'], 'work_order')
        self.assertEqual(record['kind'], 'conversation')

    def test_timeout_reaps_only_owned_toy_worker_and_retains_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'trial.json'
            real_popen = subprocess.Popen
            children = []
            def toy_worker(command, **kwargs):
                child = real_popen([sys.executable, '-c', 'import time; time.sleep(30)'], **kwargs)
                children.append(child)
                return child
            start = time.monotonic()
            with patch.object(probe.subprocess, 'Popen', toy_worker):
                self.assertFalse(probe.run(destination, 1))
            self.assertLess(time.monotonic() - start, 8)
            receipt = json.loads(destination.read_text())
            self.assertEqual(receipt['failure']['type'], 'TimeoutError')
            self.assertEqual(len(receipt['transcript']), 1)
            self.assertIsNotNone(children[0].poll())
            with self.assertRaises(ValueError):
                probe.run(destination, 1)

    def test_busy_response_is_retained_without_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'trial.json'
            real_popen = subprocess.Popen
            children = []
            code = ('import sys,json,time; r=json.loads(sys.stdin.readline()); '
                    'print(json.dumps({"id":r["id"],"status":"error","error":"busy","message":"toy busy fixture"}),flush=True); '
                    'time.sleep(30)')
            def toy_worker(command, **kwargs):
                child = real_popen([sys.executable, '-c', code], **kwargs)
                children.append(child)
                return child
            with patch.object(probe.subprocess, 'Popen', toy_worker):
                self.assertFalse(probe.run(destination, 2))
            receipt = json.loads(destination.read_text())
            self.assertEqual(len(children), 1)
            self.assertEqual(len(receipt['transcript']), 1)
            self.assertEqual(receipt['transcript'][0]['response']['error'], 'busy')
            self.assertIsNotNone(children[0].poll())


if __name__ == '__main__':
    unittest.main()
