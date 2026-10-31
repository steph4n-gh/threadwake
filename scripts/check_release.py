"""Check the distributable tree without models, credentials, or private histories."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import json
import hashlib
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'.git', '.venv', 'node_modules', '.test-results', '__pycache__',
        '.pytest_cache', 'dist', 'output', '.cache', 'build', '.docs-venv'}
REQUIRED = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'ASSETS.md',
            'README.md', 'CONTRIBUTING.md', 'docs/INSTALL.md', 'docs/TESTING.md',
            'web/index.html', 'web/guide.html', 'web/threadwake-field-guide.pdf',
            'web/audio.js', 'web/assets/audio/manifest.json', 'docs/AUDIO.md',
            'web/vendor/THREE-LICENSE.txt', 'licenses/CC-BY-4.0.txt']


class Document(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.ids, self.links, self.images = set(), [], []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.add(attrs['id'])
        for attr in ('href', 'src'):
            if attrs.get(attr):
                self.links.append(attrs[attr])
        if tag == 'img':
            self.images.append(attrs)


def main():
    errors, links = [], 0
    files = [p for p in ROOT.rglob('*') if p.is_file()
             and not set(p.relative_to(ROOT).parts) & SKIP]
    documents = {p.resolve(): Document(p.read_text()) for p in files if p.suffix == '.html'}
    for name in REQUIRED:
        if not (ROOT / name).is_file():
            errors.append('Missing required release file: ' + name)
    for path in files:
        relative = path.relative_to(ROOT).as_posix()
        if path.name == '.env' or path.name.startswith('.env.'):
            errors.append('Environment file in distributable tree: ' + relative)
        if path.is_symlink():
            errors.append('Release contains a symbolic link: ' + relative)
        if path.stat().st_size > 50 * 1024 * 1024:
            errors.append('Unexpected large file (weights belong outside release): ' + relative)
        if set(path.relative_to(ROOT).parts) & {'evidence', 'state', 'models', 'snapshot'}:
            errors.append('Private/generated directory in distributable tree: ' + relative)
        if path.suffix in {'.py', '.js', '.mjs', '.html', '.css', '.md', '.json', '.toml', '.yml'}:
            source = path.read_text()
            if path.resolve() != Path(__file__).resolve():
                for pattern in (r'/Volumes/Storage/', r'/Users/[^/\s]+/',
                                r'\bgh[pousr]_[A-Za-z0-9]{30,}', r'\bsk-[A-Za-z0-9]{32,}'):
                    if re.search(pattern, source):
                        errors.append('Private path or credential pattern: ' + relative)
        if path.suffix == '.html':
            doc = documents[path.resolve()]
            targets = doc.links
            for image in doc.images:
                if 'alt' not in image:
                    errors.append('Image has no alternative text: ' + relative)
        elif path.suffix == '.md':
            targets = re.findall(r'\]\(([^)]+)\)', path.read_text())
        else:
            continue
        for target in targets:
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or target in ('#', ''):
                continue
            destination = (path.parent / unquote(parsed.path)).resolve() if parsed.path else path.resolve()
            if not destination.is_relative_to(ROOT):
                errors.append('Local link escapes release: ' + relative + ' -> ' + target)
            elif not destination.exists():
                errors.append('Missing local target: ' + relative + ' -> ' + target)
            elif parsed.fragment and destination in documents and parsed.fragment not in documents[destination].ids:
                errors.append('Missing anchor: ' + relative + ' -> ' + target)
            links += 1
    if (ROOT / 'web/threadwake-field-guide.pdf').exists():
        if not (ROOT / 'web/threadwake-field-guide.pdf').read_bytes().startswith(b'%PDF-'):
            errors.append('Manual is not a PDF')
    # Pin the shipped encodings to their measured manifest. This is an integrity
    # check; actual decoding and listening remain separate release checks.
    manifest_path = ROOT / 'web/assets/audio/manifest.json'
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        expected = {f'{stem}.{codec}' for stem in ('foundation', 'filigree') for codec in ('ogg', 'mp3')}
        if set(manifest['files']) != expected:
            errors.append('Audio manifest must contain both stems and codec alternatives')
        identities = {ROOT / 'scripts/audio/score.json': manifest['scoreSHA256'],
                      ROOT / 'scripts/audio/render_score.py': manifest['rendererSHA256']}
        identities.update({manifest_path.parent / name: entry['sha256'] for name, entry in manifest['files'].items()})
        for path, digest in identities.items():
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                errors.append('Audio source/asset differs from measured manifest: ' + str(path.relative_to(ROOT)))
    print(json.dumps({'pass': not errors, 'files_checked': len(files),
                      'local_links_checked': links, 'errors': errors}, indent=2))
    return bool(errors)


if __name__ == '__main__':
    sys.exit(main())
