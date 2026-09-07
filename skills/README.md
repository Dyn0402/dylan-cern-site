# Claude skills for this repo

Two workflows here are meant to be usable **from any other repository** without
opening this one — publishing a note, and updating the X17 analysis board. Both
are packaged as personal Claude skills, and Claude only finds a skill under
`~/.claude/skills/`, which is per-machine and not version controlled.

So the canonical copies live here and are installed by copying:

```
mkdir -p ~/.claude/skills
cp -r skills/publish-note skills/x17-board ~/.claude/skills/
```

A symlink works too and keeps them in sync automatically, which is the better
choice on a machine where you also edit them:

```
ln -sfn "$PWD/skills/publish-note" ~/.claude/skills/publish-note
ln -sfn "$PWD/skills/x17-board"    ~/.claude/skills/x17-board
```

| skill | what it does |
|---|---|
| `publish-note` | publish a self-contained HTML note to `/notes/` via `scripts/add-note.py` |
| `x17-board` | read and update the analysis board at `/x17/analysis.html` via `scripts/x17_board.py` |

**These are copies, and copies drift.** If you change a script's flags or
subcommands, update the skill in this directory *and* reinstall it — the
README's top-level sections say the same thing at each script. Both skills
already carry the Linux/Mac and Windows repo paths, so no per-machine editing
is needed.
