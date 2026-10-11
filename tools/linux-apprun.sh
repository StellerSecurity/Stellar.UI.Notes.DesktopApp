#!/bin/sh
set -eu

# Never silently weaken Chromium isolation when user namespaces are unavailable.
if [ -n "${ELECTRON_DISABLE_SANDBOX:-}" ]; then
  echo "Stellar Notes cannot start with ELECTRON_DISABLE_SANDBOX set." >&2
  exit 1
fi
for arg in "$@"; do
  case "$arg" in
    --no-sandbox|--no-sandbox=*|--disable-sandbox|--disable-sandbox=*)
      echo "Stellar Notes requires sandboxing. Remove the sandbox-disabling option." >&2
      exit 1
      ;;
  esac
done

if [ -z "${APPDIR:-}" ]; then
  APPDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
fi
export APPDIR
# No inherited empty path components or current-directory library lookup.
export LD_LIBRARY_PATH="$APPDIR/usr/lib"
export XDG_DATA_DIRS="$APPDIR/usr/share:/usr/local/share:/usr/share"
export GSETTINGS_SCHEMA_DIR="$APPDIR/usr/share/glib-2.0/schemas"
exec "$APPDIR/stellar-notes" "$@"
