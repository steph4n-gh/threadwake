# Install and launch

## Authored demo: no model required

1. Download and extract the public repository, or clone `https://github.com/steph4n-gh/threadwake.git`.
2. Open a terminal in the repository root. Use Python 3.11 or later.
3. Run `python3 -B server.py`, then open `http://127.0.0.1:8769/`.

The demo host uses only Python’s standard library. There is no package-install or asset-build step for play. Node.js is needed for development tests, not the demo. On Windows use `py -3 -B server.py` if appropriate. On macOS, double-click `Launch.command` as an alternative.

Keep the host terminal open while playing. Ctrl+C stops a host you started there. The launcher only reuses a public Threadwake host with matching identity, mode and source; it does not take over another application. If port 8769 is occupied by something else, leave it alone and run:

```sh
python3 -B server.py --port 8770
```

Open the corresponding address. The host binds to loopback; it is not a public multiplayer server. See [hosting.md](hosting.md) for the tested launcher, capabilities and request-boundary details.

## Browser and saves

Use a desktop browser with WebGL2 and JavaScript, keyboard and mouse/trackpad. Opening `web/index.html` directly is not the supported game launch path. `web/guide.html` and the PDF can be read offline.

Your save is per browser origin and slot. Keep the same hostname, port and profile. `127.0.0.1:8769`, `localhost:8769`, another port, private browsing and a hosted demo use separate storage. One active tab per slot avoids competing save writes. Clearing site data removes its saves; starting anew replaces the current slot.

## Optional local models

Follow [LOCAL_MODEL.md](LOCAL_MODEL.md) for the Apple Silicon MLX setup. Model files and the optional Python dependencies are separate, consented downloads. Starting the default host or launcher does not download weights. The demo uses labeled authored calibrations; only a completed local capture supplies a measured spectrum.

## Alpha limits

There is no self-contained app installer. Demo hosting is standard-library Python, but broad browser/OS/hardware coverage has not been fully qualified. Local MLX is for Apple Silicon macOS, not a Windows/Linux native inference port. Minimum RAM, complete-campaign timing and sustained performance across machines remain open. See the [field guide](../web/guide.html) for controls, recovery options and troubleshooting.
