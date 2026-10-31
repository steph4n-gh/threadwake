"""Local model locations and an offline, import-free setup check."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / 'models.json').read_text())['models']


def data_dir():
    override = os.environ.get('THREADWAKE_DATA_DIR')
    if override:
        path = Path(override).expanduser().resolve()
    elif platform.system() == 'Darwin':
        path = Path.home() / 'Library' / 'Application Support' / 'Threadwake'
    elif platform.system() == 'Windows':
        path = Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData/Local'))) / 'Threadwake'
    else:
        path = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'threadwake'
    path = path.expanduser().resolve()
    if path == ROOT or ROOT in path.parents:
        raise ValueError('THREADWAKE_DATA_DIR must be outside the checkout.')
    path.mkdir(parents=True, exist_ok=True)
    if not os.access(path, os.W_OK):
        raise OSError('Threadwake data directory is not writable.')
    return path


def diagnostics_dir():
    if os.environ.get('THREADWAKE_DIAGNOSTICS') != '1':
        return None
    path = data_dir() / 'logs'
    path.mkdir(parents=True, exist_ok=True)
    return path


def model_path(variant):
    model = MANIFEST[variant]
    return data_dir() / 'models' / variant / model['revision']


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model(variant, *, hashes=True):
    """Check all pinned files. Launch preflight uses sizes; loading uses hashes."""
    path = model_path(variant)
    if path.is_dir():
        extra = {file.name for file in path.iterdir() if file.is_file()} - set(MANIFEST[variant]['files']) - {'.DS_Store'}
        if extra:
            raise ValueError(f'{variant}: unexpected model files: {", ".join(sorted(extra))}. Use a clean model directory.')
    for name, expected in MANIFEST[variant]['files'].items():
        file = path / name
        if not file.is_file() or file.stat().st_size != expected['size']:
            raise FileNotFoundError(f'{variant}: missing or incomplete {name}; run setup_models.py download --model {variant}.')
        if hashes and sha256_file(file) != expected['sha256']:
            raise ValueError(f'{variant}: SHA256 mismatch for {name}; remove that file and repeat explicit setup.')
    return path


def native_status():
    """No MLX imports, network, model loading, or claim of native qualification."""
    variants = {}
    for variant in MANIFEST:
        try:
            verify_model(variant, hashes=False)
            variants[variant] = {'available': True}
        except (OSError, ValueError) as error:
            variants[variant] = {'available': False, 'message': str(error)}
    supported = platform.system() == 'Darwin' and platform.machine() == 'arm64'
    dependencies = all(importlib.util.find_spec(name) is not None for name in ('mlx', 'mlx_lm'))
    available = supported and dependencies and all(v['available'] for v in variants.values())
    if not supported:
        message = 'Optional local inference currently requires Apple Silicon macOS.'
    elif not dependencies:
        message = 'Install the locked local-model extra with uv sync --locked --extra local-model.'
    elif not available:
        message = 'Download both pinned models explicitly with setup_models.py. Demo mode remains available.'
    else:
        message = 'Experimental local mode is configured; full hashes are checked before loading. Native behavior is not certified by this check.'
    return {'available': available, 'message': message, 'variants': variants}
