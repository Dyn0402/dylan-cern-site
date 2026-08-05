#!/usr/bin/env bash
#
# Deploy the static site to CERN EOS web hosting (https://dneff.web.cern.ch/).
#
# SAFETY — the www root holds content this repo does NOT own:
#
#   x17/                 live DAQ dashboard, regenerated automatically by the
#                        stats job at the beamline. Never write inside it.
#   trigger_scheme.html  standalone page, hand-published.
#
# Therefore: copy only this repo's own files, and NEVER pass --delete or
# mirror the whole www root. Adding a file here means adding it to PAYLOAD.
#
# Requires a valid Kerberos ticket (`kinit dneff@CERN.CH`) so EOS is readable
# through the delegated credentials. If you get "Permission denied" on /eos,
# your forwarded ticket has likely expired -- run `ssh -O exit lxplus` to drop
# the stale ControlPersist master, then retry.

set -euo pipefail

REMOTE="${REMOTE:-lxplus}"
WWW="${WWW:-/eos/user/d/dneff/www}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Only these paths are ever pushed.
PAYLOAD=(index.html style.css js assets cv data projects)

cd "$SRC"

# Render pages/ first: what gets rsynced can never lag its sources.
python3 scripts/build.py

for p in "${PAYLOAD[@]}"; do
  [[ -e "$p" ]] || { echo "missing payload item: $p" >&2; exit 1; }
done

echo "Deploying ${PAYLOAD[*]} -> ${REMOTE}:${WWW}/"

# -r not -a: EOS/fuse rejects chown and most permission/time preservation.
rsync -rvz --no-perms --no-owner --no-group --omit-dir-times \
  "${PAYLOAD[@]}" "${REMOTE}:${WWW}/"

echo
echo "Done. Verifying the untouched neighbours are still present:"
ssh "$REMOTE" "ls -d ${WWW}/x17 ${WWW}/trigger_scheme.html && ls ${WWW}/x17/"
