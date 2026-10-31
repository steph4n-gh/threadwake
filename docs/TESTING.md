# Testing

## Offline CPU checks

Use Node.js 22 and Python 3.12 for the development test environment:

```sh
npm test
python3 scripts/check_release.py
```

The public test driver uses built-in Node/Python facilities. It needs no model files, download, GPU or browser. Its ten groups cover authored campaign rules, saves/fallbacks, optical routing, record matching, request/proposal boundaries, the stdlib host, model-file setup, resource-guard failures and the native probe’s owned-child cleanup using a toy worker. The optional MLX CPU-math tests are deliberately outside this dependency-free command; it does not count unrun native tests as passed. Generated results go to the ignored `.test-results/` directory. The release checker separately checks public package links, assets, file scope and privacy.

These checks do not prove that the 3D interface is readable, that native inference worked, or that an hour of play is engaging. State what you actually tested in a change report.

## Browser checks

Start `python3 -B server.py`. In a fresh save slot, check title readiness, Begin, movement, orbit/zoom, interaction prompt, pause/resume and Continue. Use an isolated slot for tests that start a new crossing. Check narrow and desktop guide layouts, keyboard navigation, every FAQ answer and the PDF link.

For world/UI changes, retain unmodified screenshots at the actual viewport. Check instrument readability and near/behind visibility, then exercise the relevant ordinary-control route. Fixtures are useful for a bounded state, but are not a complete campaign playthrough.

## Optional native checks

Follow [LOCAL_MODEL.md](LOCAL_MODEL.md). File verification and authored CPU fixtures are separate from an actual measured capture. A useful native check records the public revision, platform, request mode, returned provenance and before/after spectrum, including failed or unchanged results. Never call an authored reference or historical replay a fresh measurement. Avoid publishing raw private prompts or logs.

## Field-guide build

`web/guide.html` is the editable source of the downloadable book. Install `docs/pdf/requirements.txt` in a build environment, then run:

```sh
python3 docs/pdf/build_guide.py
```

The builder uses repository-relative paths and portable fonts. It preserves the source’s full text, tables and closed FAQ answers. Render the resulting PDF with Poppler and inspect every page after a meaningful change. Check original pixel size, placed size/PPI, aspect ratio, diagram bounds, glyphs and pagination; do not stretch or upscale screenshots to hide source limits. Browser CSS changes and PDF layout are separate checks.
