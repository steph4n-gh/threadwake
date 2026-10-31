# Testing

## Offline CPU checks

Use Node.js 22 and Python 3.12 for the development test environment:

```sh
npm test
python3 scripts/check_release.py
```

The public test driver uses built-in Node/Python facilities. It needs no model files, download, GPU or browser. Its twelve groups cover authored campaign rules, saves/fallbacks, optical routing, neural source replay, record matching, mocked audio lifecycle and codec fallback, request/proposal boundaries, the stdlib host, model-file setup, resource-guard failures and the native probe’s owned-child cleanup using a toy worker. The optional MLX CPU-math tests are deliberately outside this dependency-free command; it does not count unrun native tests as passed. Generated results go to the ignored `.test-results/` directory. The release checker separately checks public package links, assets, file scope and privacy.

These checks do not prove that the 3D interface is readable, that native inference worked, or that an hour of play is engaging. State what you actually tested in a change report.

## Browser checks

Start `python3 -B server.py`. In a fresh save slot, check title readiness, Begin, movement, orbit/zoom, interaction prompt, pause/resume and Continue. Use an isolated slot for tests that start a new crossing. Check narrow and desktop guide layouts, keyboard navigation, every FAQ answer and the PDF link.

For world/UI changes, retain unmodified screenshots at the actual viewport. Check instrument readability and near/behind visibility, then exercise the relevant ordinary-control route. Fixtures are useful for a bounded state, but are not a complete campaign playthrough.

## Neural source replay checks

Use an isolated save slot and record the revision, browser and fixture or campaign entry route. Check Before/After on both the world voice table and console: retain the same optics and mixture weights, show only the selected record’s dry trace, and verify that secondary bands can change whether a receiver passes while the leading action stays fixed. Receiver lightwells must compare current received power with fixed minimum/maximum collars; the readiness gate must follow every receiver, contact and routing requirement. Source switching and repeated dry probes must leave heat, strain, scars, captures, rotors and allocations unchanged. Commit is a separate action.

Check AUTHORED browser pairs, actual retained local pairs, mixed inputs and legacy records with no before measurement; never synthesize a missing measurement or describe replay as a fresh capture. Verify source selection survives Continue, stale work-order previews are invalidated, and committed phase/history vectors and provenance survive later retuning or replacement. CPU fixtures with native-shaped records test plumbing, not inference. A constructed Chapter 4 cold fixture verifies a bounded interface state; it does not qualify live inference or ordinary campaign progression.

## Audio checks

Use an isolated save slot and record the browser, audio output and source revision. Start with a comfortable device volume. Open **Sound & music** in pause and H-help; use pointer and keyboard controls to adjust Master, Music, Ambience and Effects. Confirm the displayed percentages agree in both panels. Check M and the mute button in the world, pause and help, including while a volume slider has focus. Muting must preserve the four levels. Reload and Continue to check preferences persist independently of the crossing; do not clear site data or replace an unrelated save for this check.

Listen to the score alone, ambience alone and effects alone, then together. Exercise ordinary movement, a companion briefing and a discovered machine control; check distance and camera direction where relevant. Confirm a signal cue reflects the currently retained bands without relabeling an authored calibration as a measured model result. Check pause, hide/show and mute/unmute transitions for unwanted sound, abrupt changes and duplicate playback. Include at least two full 192-second music loops when assessing repetition and the join; preserve interruptions and failures instead of treating elapsed time as a pass.

Check music loading and the MP3 alternative in an owned browser fixture, including unavailable assets and a fresh browser profile that has not yet allowed audio. Keep this separate from listening through the player's actual output device. Rebuild and decoded-file checks should record sample count, codec, peak level, clipping/nonfinite samples, loop boundary and stereo-to-mono behavior. Automated graph/codec measurements, an audible-device listening pass and subjective music preference are different evidence; report each separately. See [AUDIO.md](AUDIO.md) for source and build details. None of these checks alone qualifies the full campaign or a quantified sound-quality improvement.

## Optional native checks

Follow [LOCAL_MODEL.md](LOCAL_MODEL.md). File verification and authored CPU fixtures are separate from an actual measured capture. A useful native check records the public revision, platform, request mode, returned provenance and before/after spectrum, including failed or unchanged results. Never call an authored reference or historical replay a fresh measurement. Avoid publishing raw private prompts or logs.

## Field-guide build

`web/guide.html` is the editable source of the downloadable book. Install `docs/pdf/requirements.txt` in a build environment, then run:

```sh
python3 docs/pdf/build_guide.py
```

The builder uses repository-relative paths and portable fonts. It preserves the source’s full text, tables and closed FAQ answers. Render the resulting PDF with Poppler and inspect every page after a meaningful change. Check original pixel size, placed size/PPI, aspect ratio, diagram bounds, glyphs and pagination; do not stretch or upscale screenshots to hide source limits. Browser CSS changes and PDF layout are separate checks.
