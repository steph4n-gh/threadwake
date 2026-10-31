#!/bin/zsh
set -eu
cd "${0:A:h}"
if [[ -x .venv/bin/python ]]; then
  THREADWAKE_PYTHON=.venv/bin/python
elif command -v python3 >/dev/null 2>&1; then
  THREADWAKE_PYTHON=$(command -v python3)
else
  print "Threadwake needs Python 3.11 or newer. See the public installation guide."
  exit 1
fi
if ! "$THREADWAKE_PYTHON" -c 'import sys; raise SystemExit(sys.version_info < (3, 11))'; then
  print "Threadwake needs Python 3.11 or newer."
  exit 1
fi
exec "$THREADWAKE_PYTHON" -B server.py --open-browser --reuse "$@"
