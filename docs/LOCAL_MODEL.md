# Optional local models

Start with the [authored demo](INSTALL.md) if you just want to play. It needs no model files and does not label its designed calibrations as measurements.

## Requirements

The optional backend uses MLX / MLX-LM on Apple Silicon macOS, with Python 3.11 through 3.14. Use [uv](https://docs.astral.sh/uv/getting-started/installation/) for the locked optional environment. The pinned E2B and E4B checkpoints require about 8.8 GB of downloads in total, plus runtime disk and memory. A minimum RAM requirement has not been qualified.

The exact repositories, revisions, file hashes, model cards and terms are in [`models.json`](../models.json). Review those cards and terms yourself. Game/content licenses do not grant rights to external weights, and no weights are included in this repository.

## Setup

From the repository root:

```sh
uv sync --locked --extra local-model
.venv/bin/python setup_models.py status
```

After reading the model cards and terms, explicitly accept and fetch the pinned files:

```sh
.venv/bin/python setup_models.py download --model all --accept-model-license
.venv/bin/python setup_models.py verify
.venv/bin/python -B server.py --local-model
```

Both models are required for the complete local-model mode. The launcher does not fetch missing weights. The default macOS data directory is `~/Library/Application Support/Threadwake`; models are stored under `models/<role>/<revision>`. Set `THREADWAKE_DATA_DIR` to use another data directory outside the checkout. Keep the exact pinned files for reproducible setup.

Open `http://127.0.0.1:8769/`. Use the same hostname, port and browser profile when returning to an existing save. Check the mode badge; installed files alone do not mean a capture has completed successfully. If inference cannot run, manual controls, authored briefings and Recovery calibrations remain available.

## What is measured?

- **E2B:** local Bridge/Shelter/Surge action probabilities. Steering temporarily changes an internal activation during the request; saved weights are not edited. The returned action may differ from your target.
- **E4B:** structured interpretation of discovered machine controls and matching of discovered records or eligible agreements. It is not steered, does not invent companion speech/history, and cannot accept terms or spend resources on your behalf.
- **Authored calibration:** a designed reference for play without inference. It is not a measured local result. Historical replay is also not a fresh capture.

These public checkpoints and their direct backend are experimental. Earlier development results are not a qualification of every public install, model request or hardware configuration. No personality-neuron discovery is claimed.

## Privacy and operation

Runtime inference stays on your computer. Downloading models contacts their external host only after explicit consent. Diagnostics are off by default; `THREADWAKE_DIAGNOSTICS=1` can retain raw prompts/results in local logs. Review or redact logs before sharing. Browser saves may also retain your inputs and choices.

Use only your own local host. Do not expose it as a network service. Stop it with Ctrl+C when done; do not terminate other applications to free resources. A busy or failed local request is a reason to use the demo/manual path, not to treat an authored fallback as measured evidence.
