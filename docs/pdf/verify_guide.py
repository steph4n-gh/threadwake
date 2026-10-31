"""Check the current rendered book; visual approval is an explicit human attestation."""
from pathlib import Path
import argparse
import hashlib
import json
import re

from lxml import html
from PIL import Image
import pdfplumber
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / 'build/pdf-review'
WEB = ROOT / 'web'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--visual-reviewed', action='store_true', help='Attest that every current page PNG was visually inspected.')
    args = parser.parse_args()
    pdf = WEB / 'threadwake-field-guide.pdf'
    receipt = json.loads((BUILD / 'receipt.json').read_text())
    assert sha(pdf) == receipt['pdfSHA256'] == sha(BUILD / 'threadwake-field-guide.pdf')
    assert sha(WEB / 'guide.html') == receipt['sourceHTMLSHA256']
    reader = PdfReader(pdf)
    source = html.fromstring((WEB / 'guide.html').read_bytes())
    source_images = source.xpath('//main//img')
    embedded = []
    outside = []
    with pdfplumber.open(pdf) as document:
        for number, page in enumerate(document.pages, 1):
            embedded += [(number, im) for im in page.images]
            outside += [{'page': number, 'text': c['text']} for c in page.chars
                        if c['x0'] < 0 or c['x1'] > 612.01 or c['top'] < 0 or c['bottom'] > 792.01]
    assert not outside and len(embedded) == len(source_images)
    images = []
    for source_image, (page, placed) in zip(source_images, embedded):
        path = WEB / source_image.get('src')
        with Image.open(path) as original:
            pixels = original.size
        assert tuple(placed['srcsize']) == pixels
        width, height = placed['width'], placed['height']
        error = abs((width / height) / (pixels[0] / pixels[1]) - 1)
        assert error < 1e-6
        images.append({'source': str(path.relative_to(ROOT)), 'sourceSHA256': sha(path),
                       'page': page, 'originalPixels': pixels, 'embeddedPixels': placed['srcsize'],
                       'placedPoints': [width, height], 'effectivePPI': [pixels[0] * 72 / width, pixels[1] * 72 / height],
                       'relativeAspectError': error, 'resamplingUpsamplingOrCropping': False})
    text = '\n'.join(p.extract_text() for p in reader.pages)
    normalized = lambda value: re.sub(r'\W+', '', value).lower()
    forbidden = ['gemmaBSS', 'snapshot/src', '../.venv', 'prepared Mac workspace', 'Round 86', '/Users/', '/Volumes/']
    assert not any(value in text for value in forbidden)
    assert '\ufffd' not in text and '\u25a0' not in text
    assert receipt['allFAQAnswersExpanded'] and not receipt['missingCanonicalUnits']
    manifest = []
    for number in range(1, len(reader.pages) + 1):
        path = BUILD / 'rendered' / f'page-{number:02d}.png'
        assert path.is_file(), 'Render every page before verifying.'
        manifest.append({'page': number, 'path': str(path.relative_to(ROOT)), 'sha256': sha(path)})
    history = BUILD / 'history'
    for old in (BUILD / 'rendered').glob('page-*.png'):
        if int(old.stem.split('-')[-1]) > len(reader.pages):
            history.mkdir(exist_ok=True)
            destination = history / ('obsolete-' + old.name)
            if destination.exists():
                old.unlink()
            else:
                old.rename(destination)
    audit = {'pdfSHA256': sha(pdf), 'images': images, 'textOutsidePage': outside,
             'vectors': 'Map, workflow, spectra and rotor rules are source-derived PDF vectors. Check complete label bounds visually.',
             'rasterQuality': 'Original pixels retained. The cover is a scene illustration at about176 PPI; portraits are about1237 PPI. No invented resolution.',
             'visualInspection': 'Attested for every current page.' if args.visual_reviewed else 'Pending human review.',
             'renderManifest': manifest}
    (BUILD / 'image-sizing-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    receipt.update({'verification': 'PASS', 'pdfBytes': pdf.stat().st_size, 'imageSizingAuditSHA256': sha(BUILD / 'image-sizing-audit.json'),
                    'buildScriptSHA256': sha(ROOT / 'docs/pdf/build_guide.py'), 'renderManifest': manifest,
                    'visualReview': audit['visualInspection'], 'privateSetupWordingAbsent': True})
    (BUILD / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'pages': len(reader.pages), 'pdfSHA256': sha(pdf), 'images': len(images),
                      'verification': 'PASS', 'visualReview': audit['visualInspection']}, indent=2))


if __name__ == '__main__':
    main()
