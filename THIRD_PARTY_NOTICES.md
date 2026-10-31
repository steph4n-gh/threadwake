# Third-party notices

## Bundled renderer

Three.js 0.180.0, copyright the Three.js authors, is bundled in `web/vendor` under the MIT license. Its complete notice is in [web/vendor/THREE-LICENSE.txt](web/vendor/THREE-LICENSE.txt). Keep this notice when redistributing those files. The npm lockfile pins the same release; Node/npm are not required to play the already-bundled browser game.

## Optional local-model dependencies

MLX and MLX-LM are separate optional dependencies, published by Apple under the MIT license. They are installed from their packages rather than copied from the private development toolkit. See [MLX](https://github.com/ml-explore/mlx/blob/main/LICENSE) and [MLX-LM](https://github.com/ml-explore/mlx-lm/blob/main/LICENSE). Additional resolved package licenses remain their own; the Python lockfile records the dependency graph.

No model weights are bundled. Model setup pins external repository revisions and requires explicit acknowledgement of the linked model terms before downloading. Google's Gemma 4 model cards identify Apache-2.0, while some converted MLX model cards identify `gemma`; this project does not override either repository's terms or claim that its software license applies to weights. Consult the exact pinned model card and manifest used for setup. Authored calibration profiles and historical action spectra in game data are labeled separately from new inference.

## Original content and AI assistance

See [NOTICE](NOTICE), [ASSETS.md](ASSETS.md), and the in-game/guide credits for the game contributors, procedural sound, AI-assisted portraits/texture, explanatory diagrams, and captured screenshot. No hosted AI API is required during play. Development consultations are not runtime services or an endorsement of the game.

## PDF typography

The manual PDF embeds subsets of Bitstream Vera supplied with ReportLab. Its complete font license is in [docs/pdf/licenses/Bitstream-Vera.txt](docs/pdf/licenses/Bitstream-Vera.txt). The reproducible PDF builder obtains the font from the pinned ReportLab installation; no macOS system font files are redistributed. Standard PDF serif and monospace families are also used. See [docs/pdf/requirements.txt](docs/pdf/requirements.txt) for the build dependencies.
