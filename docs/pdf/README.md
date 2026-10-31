# Rebuild the field guide

`web/guide.html` is the editable source. The builder extracts its story, tables, diagrams, credits and every closed FAQ answer; it does not maintain a second written manual.

Use Python 3.11 or later in a separate documentation environment:

```sh
python3 -m venv .docs-venv
.docs-venv/bin/python -m pip install -r docs/pdf/requirements.txt
.docs-venv/bin/python docs/pdf/build_guide.py
```

The result is `web/threadwake-field-guide.pdf`, with an identical build copy and source/content receipts under ignored `build/pdf-review/`. Paths are repository-relative. ReportLab's bundled Bitstream Vera and standard PDF Times/Courier families provide portable typography; no macOS font files are required. See `licenses/Bitstream-Vera.txt` and the repository notices.

The build normalizes typographic dashes and inline navigation arrows to portable ASCII, and replaces browser-only cover navigation with linked PDF contents/bookmarks. Diagrams remain vectors. Images use their original pixel dimensions and aspect ratio, scaled uniformly to fit; no screenshot retouching or upsampling is performed. Deterministic PDF metadata allows repeat builds in the same pinned environment to produce matching bytes.

Install Poppler for your platform, then render and verify:

```sh
mkdir -p build/pdf-review/rendered
pdftoppm -r 110 -png web/threadwake-field-guide.pdf build/pdf-review/rendered/page
.docs-venv/bin/python docs/pdf/verify_guide.py
```

Inspect **every** page at a readable size for clipping, glyphs, orphaned text, page references and complete diagram labels. Check the actual image-sizing receipt: original pixels, placed points, PPI and aspect error. The cover's real source resolution is about 176 PPI at its placed width; it is a scene illustration, not enlarged HUD instructions. Do not hide source limits through invented upsampling.

After that human review, record it explicitly with:

```sh
.docs-venv/bin/python docs/pdf/verify_guide.py --visual-reviewed
```

The flag records an attestation; the script cannot judge appearance for you. Browser CSS and PDF layout remain separate checks. The downloadable PDF must be rebuilt when guide content changes.
