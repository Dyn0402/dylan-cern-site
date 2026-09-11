#!/usr/bin/env bash
#
# Push the per-track parquet shards that /x17/qa-tracks.html reads.
#
# WHY THIS IS NOT PART OF deploy-eos.sh. The shards are ~4.7 GB across 292
# files and they do not live in this repo at all -- they are built on whichever
# machine holds the 11.4 GB campaign track table, by
#
#     python -m sept26_prelim_analysis.trackqa_shards
#
# and pushed straight from there. Folding them into the main deploy would make
# every note edit re-scan gigabytes, and would put a 4.7 GB build product in a
# git working tree. The page reads them over HTTP range requests, so they are
# static files and nothing on the server has to know what they are.
#
# The site expects them at $WWW/x17/trackqa/tracks/, which is what
# `data/x17-trackqa.json` tells the page to look for. Change one, change both.
#
# Like deploy-eos.sh this NEVER passes --delete: a sub-run whose shard is
# rebuilt is overwritten, and one that disappears from the build stays served
# until removed by hand.
#
#     ./scripts/deploy-trackqa.sh                 # everything
#     ./scripts/deploy-trackqa.sh run_145 run_86  # only these runs
#     DRY=1 ./scripts/deploy-trackqa.sh           # list what would go
#
# Needs a Kerberos ticket (`kinit dneff@CERN.CH`); if /eos says "Permission
# denied", drop the stale master with `ssh -O exit lxplus` and retry.

set -euo pipefail

REMOTE="${REMOTE:-lxplus}"
WWW="${WWW:-/eos/user/d/dneff/www}"
SRC="${TRACKQA_SRC:-/media/dylan/data/x17/sept26_prelim/trackqa_web}"
DEST="${WWW}/x17/trackqa/tracks"

[[ -d "$SRC/tracks" ]] || {
  echo "no shard build at $SRC/tracks" >&2
  echo "  build it first:  python -m sept26_prelim_analysis.trackqa_shards" >&2
  echo "  or point \$TRACKQA_SRC at an existing build" >&2
  exit 1
}
[[ -f "$SRC/shard_index.json" ]] || {
  echo "no shard_index.json in $SRC -- the build did not finish" >&2
  exit 1
}

# Which files. With no argument, all of them; with run names, only those runs.
# The shard filename is <run>__<subrun>.parquet, so a run is a prefix match and
# there is no index to keep in step.
FILTER=()
if (( $# )); then
  for run in "$@"; do FILTER+=(--include="${run}__*.parquet"); done
  FILTER+=(--include='*/' --exclude='*')
fi

n=$(ls -1 "$SRC/tracks"/*.parquet 2>/dev/null | wc -l)
sz=$(du -sh "$SRC/tracks" | cut -f1)
echo "Pushing ${n} shard(s), ${sz} total, from ${SRC}/tracks"
echo "                    -> ${REMOTE}:${DEST}/"
[[ -n "${DRY:-}" ]] && echo "(DRY run: nothing is written)"

ssh "$REMOTE" "mkdir -p ${DEST}"

# --size-only, not -t. These files are immutable for a given build: a shard is
# rewritten only when the track table behind it is, and then its size changes
# too. Comparing sizes lets a resumed push skip what is already there without
# depending on EOS accepting utime, which it does not always do.
rsync -rv --size-only --no-perms --no-owner --no-group --omit-dir-times \
  ${DRY:+--dry-run} "${FILTER[@]}" \
  "$SRC/tracks/" "${REMOTE}:${DEST}/"

echo
echo "Done. The page finds these through data/x17-trackqa.json, which is frozen"
echo "by scripts/freeze_x17_trackqa.py --index ${SRC}/shard_index.json --"
echo "so if you added sub-runs, re-freeze and re-run ./scripts/deploy-eos.sh too."
