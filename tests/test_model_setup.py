"""Offline setup/worker tests. No MLX import, model load, or download."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import brain
import model_config
import setup_models


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.environment = patch.dict(os.environ, {'THREADWAKE_DATA_DIR': self.directory.name, 'THREADWAKE_DIAGNOSTICS': '0'})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        payload = b'fixture model bytes; never a neural witness'
        self.payload = payload
        self.manifest = {'e2b': {
            'revision': 'a' * 40, 'repository': 'example/fixture',
            'model_card': 'https://example.invalid/card', 'license_url': 'https://example.invalid/terms',
            'files': {'config.json': {'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}},
        }}
        self.pinned = patch.object(model_config, 'MANIFEST', self.manifest)
        self.pinned.start()
        self.addCleanup(self.pinned.stop)

    def test_record_is_disabled_by_default(self):
        brain.record('request.jsonl', {'text': 'secret fixture'})
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])
        with patch.dict(os.environ, {'THREADWAKE_DIAGNOSTICS': '1'}):
            brain.record('request.jsonl', {'text': 'explicit fixture'})
        self.assertEqual(json.loads((Path(self.directory.name) / 'logs/request.jsonl').read_text())['text'], 'explicit fixture')

    def test_checkout_cannot_be_runtime_directory(self):
        with patch.dict(os.environ, {'THREADWAKE_DATA_DIR': str(ROOT / 'runtime')}):
            with self.assertRaises(ValueError):
                model_config.data_dir()

    def test_download_requires_explicit_license_flag(self):
        with patch.object(setup_models.urllib.request, 'urlopen', side_effect=AssertionError('network must not run')):
            with self.assertRaises(ValueError):
                setup_models.download('e2b')

    def test_download_hashes_and_reuses_only_verified_files(self):
        with patch.object(setup_models.urllib.request, 'urlopen', return_value=io.BytesIO(self.payload)) as fetch:
            setup_models.download('e2b', accept_license=True)
            self.assertIn('/resolve/' + 'a' * 40 + '/config.json', fetch.call_args.args[0])
        self.assertTrue(model_config.verify_model('e2b').is_dir())
        with patch.object(setup_models.urllib.request, 'urlopen', side_effect=AssertionError('already verified')):
            setup_models.download('e2b', accept_license=True)

    def test_bad_download_never_overwrites_existing_file(self):
        path = model_config.model_path('e2b')
        path.mkdir(parents=True)
        (path / 'config.json').write_bytes(b'old incomplete file')
        with patch.object(setup_models.urllib.request, 'urlopen', return_value=io.BytesIO(b'x' * len(self.payload))):
            with self.assertRaises(ValueError):
                setup_models.download('e2b', accept_license=True)
        self.assertEqual((path / 'config.json').read_bytes(), b'old incomplete file')
        self.assertFalse(list(path.glob('*.partial')))

    def test_size_only_preflight_is_not_hash_verification(self):
        path = model_config.model_path('e2b')
        path.mkdir(parents=True)
        (path / 'config.json').write_bytes(b'x' * len(self.payload))
        model_config.verify_model('e2b', hashes=False)
        with self.assertRaises(ValueError):
            model_config.verify_model('e2b')

    def test_extra_model_files_are_not_silently_loaded(self):
        path = model_config.model_path('e2b')
        path.mkdir(parents=True)
        (path / 'config.json').write_bytes(self.payload)
        (path / 'model-extra.safetensors').write_bytes(b'unpinned')
        with self.assertRaisesRegex(ValueError, 'unexpected model files'):
            model_config.verify_model('e2b')

    def test_preflight_does_not_import_mlx_or_download(self):
        code = ('import sys, model_config; '
                'assert "mlx" not in sys.modules; '
                'assert not model_config.native_status()["available"]; '
                'assert "mlx" not in sys.modules')
        result = subprocess.run([sys.executable, '-B', '-c', code], cwd=ROOT, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_invalid_worker_requests_do_not_load_models(self):
        requests = [{'id': 'bad-relay', 'relay': 7}, {'id': 'bad-scope', 'scope': 'foreign'}, {'op': 'close'}]
        run = subprocess.run([sys.executable, '-B', str(ROOT / 'brain.py')],
                             input=''.join(json.dumps(item) + '\n' for item in requests),
                             text=True, capture_output=True, timeout=10, cwd=ROOT)
        self.assertEqual(run.returncode, 0, run.stderr)
        results = [json.loads(line) for line in run.stdout.splitlines()]
        self.assertEqual([r['id'] for r in results], ['bad-relay', 'bad-scope'])
        self.assertTrue(all(r['error'] == 'invalid' for r in results))
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
