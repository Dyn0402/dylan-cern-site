#!/usr/bin/env bash
#
# Deploy the static site to CERN EOS web hosting (https://dneff.web.cern.ch/).
#
# SAFETY — the www root holds content this repo does NOT own:
#
#   trigger_scheme.html  standalone page, hand-published.
#   x17/data.json        the last files the retired DAQ publisher left behind,
#   x17/runs.json        along with progress.png and ipc_yield.png. Nothing
#                        serves them now; x17/live/ carries its own copies.
#
# Therefore: copy only this repo's own files, and NEVER pass --delete or
# mirror the whole www root. Adding a file here means adding it to PAYLOAD.
#
# x17/ CHANGED HANDS. During data taking it was written by stats_collector.py
# on the DAQ machine, and this script would not touch it. Now this repo owns
# x17/index.html (the analysis hub) and x17/live/ (the frozen dashboard).
#
#   ** Stop stats_page_watcher on the DAQ machine before deploying this. **
#
# It re-uploads its own index.html on the first push of every session, so if it
# is still running it will overwrite the hub — silently, and only on restart,
# which is the worst kind of surprise. Check with:
#
#   ssh daq 'tmux ls | grep stats_page_watcher'
#
# Requires a valid Kerberos ticket (`kinit dneff@CERN.CH`) so EOS is readable
# through the delegated credentials. If you get "Permission denied" on /eos,
# your forwarded ticket has likely expired -- run `ssh -O exit lxplus` to drop
# the stale ControlPersist master, then retry.

set -euo pipefail

REMOTE="${REMOTE:-lxplus}"
WWW="${WWW:-/eos/user/d/dneff/www}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Only these paths are ever pushed. x17/ carries the hub and, under live/, the
# archived dashboard; js/ and data/ already cover x17-campaign.{js,json}.
PAYLOAD=(index.html style.css js assets cv data projects notes hub x17
         sw.js manifest.json)

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
echo "Done. Verifying the untouched neighbour, and what is now in x17/:"
ssh "$REMOTE" "ls -d ${WWW}/trigger_scheme.html && ls -l ${WWW}/x17/ ${WWW}/x17/live/"

cat <<'EOF'

The DAQ publisher's leftovers (data.json, runs.json, progress.png,
ipc_yield.png) are still in x17/ — rsync never deletes. Nothing links to them
now. To clear them, once the watcher is confirmed stopped:

    ssh lxplus 'cd /eos/user/d/dneff/www/x17 && rm -f data.json runs.json progress.png ipc_yield.png'
EOF
