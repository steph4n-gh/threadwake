# Assets and attribution

Original story, illustrations, music, synthesized sound assets and documentation are offered under CC BY 4.0 to the extent rights are held, as scoped in [NOTICE](NOTICE) and [licenses/CC-BY-4.0.txt](licenses/CC-BY-4.0.txt). Attribute them to **Threadwake contributors** and identify changes. This does not relicense third-party material or grant rights beyond those held by the contributors.

| Material | Origin |
| --- | --- |
| `web/assets/portraits/{marin,vale,iona,mara}.png` | Fictional companion portraits created with OpenAI’s image-generation tool and integrated by the contributors. |
| `web/assets/slate-tint-v1.png` | Roof texture created with OpenAI’s image-generation tool. |
| `web/assets/guide/first-light.jpg` | Unmodified actual gameplay capture. Its file records real source resolution; it is not an AI-generated scene. |
| Guide map and teaching diagrams | Original explanatory vectors/CSS and PDF vectors by the contributors. Illustrated spectra are not live measurements. |
| World geometry, interface and story | Procedural/original project content. |
| `scripts/audio/score.json` and `web/assets/audio/{foundation,filigree}.{ogg,mp3}` | *Lanterns on the Glass Meridian*: original 192-second, 80 BPM score composed by Gemini 4 Argon High for Threadwake, arranged and rendered by the contributors as two aligned music parts. Ogg Opus files have MP3 alternatives. |
| Four companion motifs | Original musical phrases contributed by Gemini/Argon and integrated into the game's synthesizer. |
| Virtual instruments and world sound | Original synthesis, rendering and Web Audio code by the contributors with Codex development assistance. Sea, wind, machinery and interaction sounds are synthesized; the score uses original virtual instruments, without third-party music recordings or sample libraries. |

Codex and collaborating development agents assisted design, code, narrative implementation, documentation and review. Gemini/Argon and separate judge/adversary agents supplied development critique. This attribution is not an endorsement or a claim that the game is complete. Development reviewers are not runtime companions or cloud inference services.

Three.js remains under its MIT license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `web/vendor/THREE-LICENSE.txt`. Optional model weights are not bundled and retain the terms of their exact external cards/manifests. The game’s Apache-2.0 software license does not apply to those weights.

Keep raster image aspect ratios and real source resolution when reusing the guide. The PDF build uses uniform scaling and vector diagrams, without screenshot alteration or invented upsampling.

Audio source, attribution and rebuild instructions are in [docs/AUDIO.md](docs/AUDIO.md). The renderer and runtime code follow the repository's software license; the score and rendered audio follow the content license. Model-driven signal sonification changes instrument cues from retained band values; it does not compose or regenerate the music.

The reproducible PDF builder uses ReportLab-bundled Bitstream Vera and standard PDF font families. Vera retains its separate [font license](docs/pdf/licenses/Bitstream-Vera.txt); no macOS font files are redistributed.
