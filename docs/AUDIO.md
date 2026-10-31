# Sound and music

Open **Sound & music** in the pause screen, or press H from the world to open the short field guide. If another panel is open, Escape closes it; Escape from the world pauses.

| Control | What it changes |
| --- | --- |
| Master | All game sound. |
| Music | The composed score. |
| Ambience | Sea, wind and nearby world textures. |
| Effects | Interaction sounds, companion motifs and instrument cues. |

M or **Mute sound** silences all channels without changing their levels. M works while a volume slider has focus; it does not interrupt typing in a text field. Volume and mute preferences persist in the same browser profile and address, separately from the crossing save. A new crossing does not reset the mix. Browser privacy settings or clearing site data can remove these preferences.

Sound needs a browser interaction to start. Begin the crossing or use a sound control, then check the browser tab and device volume if it remains silent. Pause lowers the musical and environmental background; muting silences it. Leaving the game tab hides and silences its sound. All essential instructions and conversations remain available as text.

## What you hear

*Lanterns on the Glass Meridian* is an original 192-second score at 80 BPM, arranged over 64 bars. Gemini 4 Argon High composed it for Threadwake; the contributors revised its spacing, timbres and loop voicing after review. Its synchronized **foundation** and **filigree** parts use original virtual felt, glass, pad, pluck, bell and bass instruments. The contributors built the synthesis, rendering and game integration with Codex assistance. Gemini/Argon also supplied the four short companion motifs.

The score is prepared before play. The game mixes its two parts alongside procedural sea, wind, machinery and interaction sounds. The upper part gradually opens as chapters progress; strain and low health darken the mix. It does not ask a language model to compose or stream music while you play. No third-party music recording or sample library is used.

Instrument cues can reflect current Bridge, Shelter and Surge values from a retained profile or mixture. In the demo, those can be authored calibrations; optional local-model play can supply measured spectra. Hearing a cue does not establish that a model ran. Read the instrument's provenance label, displayed bands and dry trace when making a decision.

## Sources and rebuilding

- [`scripts/audio/score.json`](../scripts/audio/score.json): the original score events and arrangement.
- [`scripts/audio/render_score.py`](../scripts/audio/render_score.py): offline instrument synthesis and encoding.
- [`web/audio.js`](../web/audio.js): runtime mixing, environmental sound and event cues.
- [`web/assets/audio/manifest.json`](../web/assets/audio/manifest.json): rendered file identities, format details and measurements.

Playing the bundled audio needs no Python audio packages. Rebuilding it requires Python with NumPy, plus `ffmpeg` and `ffprobe` on the path. From the repository root:

```sh
python3 scripts/audio/render_score.py \
  --score scripts/audio/score.json \
  --out web/assets/audio \
  --masters build/audio-masters
```

This replaces the bundled music files and manifest. It renders stereo stems, retains uncompressed review material in the ignored build directory, and supplies Ogg Opus plus MP3 alternatives. After a change, follow the separate file, browser and listening checks in [TESTING.md](TESTING.md); successful rendering is not a listening verdict.

The original score and rendered sound assets are CC BY 4.0 to the extent rights are held, attributed to **Threadwake contributors** with the composition credit above. Runtime and renderer code follow the repository's software license. See [ASSETS.md](../ASSETS.md), [NOTICE](../NOTICE) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for scope and third-party terms.
