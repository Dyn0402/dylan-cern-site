#!/usr/bin/env bash
#
# Deploy the static site to CERN EOS web hosting (https://dneff.web.cern.ch/).
#
# SAFETY — the www root holds content this repo does NOT own:
#
#   trigger_scheme.html  standalone page, hand-published.
#
# Therefore: copy only this repo's own files, and NEVER pass --delete or
# mirror the whole www root. Adding a file here means adding it to PAYLOAD.
#
# x17/ CHANGED HANDS. During data taking it was written by stats_collector.py
# on the DAQ machine, and this script would not touch it. Now this repo owns
# x17/index.html (the analysis hub), the three QA pages, and x17/live/ (the
# frozen dashboard). The publisher's four leftover files — data.json,
# runs.json, progress.png, ipc_yield.png — were removed by hand on 2026-08-12;
# x17/live/ carries its own copies of all four.
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

# Only these paths are ever pushed. x17/ carries the hub, the three QA pages
# and, under live/, the archived dashboard; js/ and data/ are whole directories,
# so a new chart or frozen dataset needs no change here.
PAYLOAD=(index.html style.css js assets cv data projects notes hub x17
         sw.js manifest.json)

cd "$SRC"

# Render pages/ first: what gets rsynced can never lag its sources.
python3 scripts/build.py

for p in "${PAYLOAD[@]}"; do
  [[ -e "$p" ]] || { echo "missing payload item: $p" >&2; exit 1; }
done

echo "Deploying ${PAYLOAD[*]} -> ${REMOTE}:${WWW}/"

# -r not -a: EOS/fuse rejects chown and permission preservation, so -a's -p and
# -o/-g are dropped and passed explicitly as --no-* below.
#
# -t is a separate decision and it is load-bearing. rsync's quick check is
# size + mtime; with no mtime preserved it considers every file new, so a
# deploy that changed one note still re-sent the whole site -- 89 files, ~85 MB,
# of which notes/ is ~82 MB. Measured locally with these exact flags:
#
#     without -t   first pass 89 files   second pass 89 files
#     with -t      first pass 89 files   second pass  0 files
#
# (--omit-dir-times below only means anything alongside -t, which is the trace
# of it having been dropped by accident when -a became -r.)
#
# The first run after this change still sends everything, because the remote
# timestamps are not the local ones yet. From the second run on it is a delta.
QUICK_CHECK="${QUICK_CHECK:--t}"

# If EOS refuses to set times, rsync says "failed to set times" and exits 23 --
# a partial-transfer code, not a failure to copy: the data did land. Catch it
# rather than letting `set -e` abort with no explanation.
rc=0
rsync -rvz "$QUICK_CHECK" --no-perms --no-owner --no-group --omit-dir-times \
  "${PAYLOAD[@]}" "${REMOTE}:${WWW}/" || rc=$?

if (( rc == 23 )) && [[ "$QUICK_CHECK" == "-t" ]]; then
  cat >&2 <<'EOF'

rsync exited 23. If the errors above are "failed to set times", EOS is
refusing utime and -t cannot be used here. The files themselves transferred.
Fall back to comparing sizes instead:

    QUICK_CHECK=--size-only ./scripts/deploy-eos.sh

That is still incremental. Its one blind spot is an edit that leaves a file
exactly as many bytes as before, so prefer -t for as long as EOS accepts it.
EOF
fi
(( rc == 0 )) || exit "$rc"

echo
echo "Done. Verifying the untouched neighbour, and what is now in x17/:"
ssh "$REMOTE" "ls -d ${WWW}/trigger_scheme.html && ls -l ${WWW}/x17/ ${WWW}/x17/live/"

cat <<'EOF'

x17/ should now hold only index.html, qa.html, qa-ntof.html, qa-match.html,
qa-pedestals.html and live/. Anything else there is a leftover: rsync never deletes, so a file that
stops being part of the payload stays served until it is removed by hand.
EOF
