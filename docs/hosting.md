# Portable local host

The default host runs the authored demo with Python 3.11 or newer and the standard library. It does not load, download or start a model.

From the project directory:

```sh
python3 -B server.py
```

Open `http://127.0.0.1:8769/`. On Windows, `py -3 server.py` is the equivalent command when Python is installed through the Python launcher. Stop this host with Ctrl+C in its terminal. The default port is 8769; `--port NUMBER` chooses another loopback port.

On macOS, double-click `Launch.command`, or run `./Launch.command`. It prefers this checkout's `.venv/bin/python`, otherwise the `python3` on PATH, checks Python 3.11+, and invokes:

```sh
python3 -B server.py --open-browser --reuse
```

`--reuse` accepts an existing host only when its health response identifies `threadwake-public`, API version 3, matching demo/local mode and the same backend source-hash map. Local mode also checks that the existing capability matches the current model/dependency preflight. A plain HTTP 200 is insufficient. An occupied, unverified port is reported; its process is never stopped. Reuse reads at most 16 KiB, with a two-second connection timeout and a separate two-second response deadline. The launcher has no private sibling environment or model-path dependency. No companion helper process is required.

## Optional local inference

After the separately documented explicit model/dependency setup, opt in with:

```sh
python3 -B server.py --local-model
```

The same flag can be passed to `./Launch.command`. Launch never downloads models. The lightweight setup check performs no MLX import or inference. It checks platform/dependencies and configured model files; it is not a native-behavior certification. Missing setup leaves native availability false while authored play remains available; that host keeps serving until stopped normally. If setup changes its availability, `--reuse` exits with a stop/restart instruction and leaves the existing host running. Stop that host with Ctrl+C in its terminal, then launch again; no second host or worker is silently started. A worker starts only after an accepted inference request in enabled, available local mode.

`GET /api/health` supplies the frontend capability contract:

| Field | Default demo | Explicit local mode |
| --- | --- | --- |
| `application` | `threadwake-public` | `threadwake-public` |
| `api_version` | `3` | `3` |
| `mode` | `authored-demo` | `local-model` |
| `native_available` | `false` | Preflight result |
| `authored_available` | `true` | `true` |
| `worker_pid` | `null` | `null` until a request starts a worker |

The existing native job/result protocol remains in use. Capability permits an attempt; an actual result and its receipt establish what ran. A static web host such as GitHub Pages does not provide this API; the browser demo needs no API.

## Runtime data and request boundaries

The default authored demo needs no runtime directory and does not create one. Native setup or explicitly enabled diagnostics create/check their runtime directory before use; an invalid path produces a plain CLI error. Defaults are macOS `~/Library/Application Support/Threadwake`, Windows `%LOCALAPPDATA%/Threadwake`, or Linux `$XDG_DATA_HOME/threadwake` (falling back to `~/.local/share/threadwake`). `THREADWAKE_DATA_DIR` can select another writable location outside the checkout. Browser game saves remain in browser storage and are separated by origin/slot and the frontend's edition namespace. Changing the host name or port selects a different browser origin; the host does not erase or migrate saves.

Prompt/result and worker-file logging is off by default. Explicit `THREADWAKE_DIAGNOSTICS=1` enables diagnostic files under the runtime directory's `logs` folder; these can contain prompts and results. The host does not write shared project evidence. HTTP access logging is disabled. The public checkout contains no model weights or automatic model download step.

The server binds numeric IPv4 loopback only. Host and Origin checks apply before all route handling, including sensitive job GETs and static responses. Cross-site/same-site API fetch metadata is rejected; same-origin, direct local requests and requests without browser-origin headers remain supported. There is no CORS opt-in. POST requests require one bounded Content-Length, JSON content type and no Transfer-Encoding: at most 4 KiB for consult and 16 KiB for campaign mind. A ten-second absolute connection deadline covers slow headers and bodies, independently of per-read progress. The native queue holds three waiting jobs; one worker handles accepted jobs with a 120-second decision deadline. Terminal job records are bounded by count and retention time. This is a local application boundary, not an authenticated multi-user or internet service.

## Host checks

```sh
python3 -B -m unittest discover -s tests -p test_host.py -v
```

Tests create and close owned ephemeral loopback hosts. They cover demo/static health without a worker, rejected foreign requests including job GETs, ambiguous/oversized bodies, actual ten-second sustained header/body trickles, queue limits with no worker, reuse identity/time bounds, an existing host with stale local availability, explicit unavailable native setup and the real demo CLI with no data directory or an invalid cache path. Required native/diagnostic cache failures produce plain CLI errors. Current native availability is mocked for the stale-host test; no model, GPU or download is used. These checks do not qualify native responses or prove a gameplay/performance release.
