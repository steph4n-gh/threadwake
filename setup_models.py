"""Explicit, hash-verified model setup. This module is never called by launch."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import urllib.request

import model_config


def download(variant, *, accept_license=False):
    model = model_config.MANIFEST[variant]
    if not accept_license:
        raise ValueError('Review the model card and terms, then add --accept-model-license: '
                         + model['model_card'] + ' ; ' + model['license_url'])
    destination = model_config.model_path(variant)
    destination.mkdir(parents=True, exist_ok=True)
    for name, expected in model['files'].items():
        path = destination / name
        if path.is_file() and path.stat().st_size == expected['size'] and model_config.sha256_file(path) == expected['sha256']:
            print(f'{variant}: verified {name}', flush=True)
            continue
        # A failed or interrupted transfer never replaces an existing model file.
        partial = path.with_name(path.name + '.partial')
        url = f"https://huggingface.co/{model['repository']}/resolve/{model['revision']}/{name}"
        print(f'{variant}: downloading {name} ({expected["size"]:,} bytes)', flush=True)
        try:
            with urllib.request.urlopen(url, timeout=60) as source, partial.open('wb') as target:
                while chunk := source.read(8 * 1024 * 1024):
                    target.write(chunk)
                    if target.tell() > expected['size']:
                        raise ValueError(f'Download exceeded pinned size: {name}')
            if partial.stat().st_size != expected['size'] or model_config.sha256_file(partial) != expected['sha256']:
                raise ValueError(f'Download failed pinned SHA256/size check: {name}')
            os.replace(partial, path)
        finally:
            partial.unlink(missing_ok=True)
    model_config.verify_model(variant)
    print(f'{variant}: all pinned files verified in {destination}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('status', 'verify', 'download'))
    parser.add_argument('--model', choices=('e2b', 'e4b', 'all'), default='all')
    parser.add_argument('--accept-model-license', action='store_true')
    args = parser.parse_args()
    if args.command == 'status':
        print(json.dumps(model_config.native_status(), indent=2))
        return
    variants = model_config.MANIFEST if args.model == 'all' else [args.model]
    for variant in variants:
        if args.command == 'download':
            download(variant, accept_license=args.accept_model_license)
        else:
            print(model_config.verify_model(variant))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
