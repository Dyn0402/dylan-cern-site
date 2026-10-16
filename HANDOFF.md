# Handoff

## Under-sink shelf (misc/shelf) — updated 2026-10-16 (dylan-MS-7C84)

**Resume:** Decide the covered-space / basin-shift geometry (3 options asked), then update `misc/shelf/build_model.py` and re-render.

**Goal:** Two-tier shelf for Dylan's under-sink cabinet in Palaiseau. Shows the design, a Blender render, a Three.js assembly animation, a varnish comparison and a Castorama shopping check, on the public site under `/misc/` (not notes or hub).

**Done:**
- v2 triangular design, then v3: right trapezoid with a flat back, lower shelf raised to 200 mm underside, upper shelf top at 460 mm (140 mm below basin bottom). Margins: 15 mm side/back, 55 mm front.
- v4: removed the right-hand standpipe and its upper-shelf notch (Dylan: "not what you think it is"). Added the four items from his photos as floor context for scale (bottle, bin-bag roll, salt box, tablet box), placed in the open front-left, not at their real positions.
- Varnish comparison on the page: water-based PU vs boiled linseed (sources and caveats on the page).
- Deployed `misc/` to EOS by targeted rsync (not the full deploy script, because it would re-push `x17/` and the DAQ watcher check was not confirmed). `misc` was added to the deploy PAYLOAD.
- Live: https://dylan-neff.web.cern.ch/misc/shelf/

**In progress / where it stopped:**
- Basin shift and covered space NOT modelled. Asked Dylan which reading he meant (his numbers conflict): (1) 50 cm extension of the cabinet to the left, basin moves into it, panel-covered, reached through the opening; (2) 50 cm of depth in a hidden compartment on the left, basin shifts within the 40 cm width; (3) something else (e.g. height). Basin is about 30 cm wide and already sits against the left wall in the photo, so a 10 cm left shift does not fit in the 40 cm opening as written.
- Scale-item sizes are approximate product sizes, not measured (perspective made the tape unreliable).

**Next steps:**
1. Get Dylan's answer on the covered space / basin shift (see above).
2. Model it in `build_model.py` (basin is `CTX basinB/basinF/basinBk/basinL/basinR`; counter at z 700); extend `CAB` if the cabinet gets wider; re-run checks.
3. Re-render: `blender -b ... render_blender.py`; check `renders/shelf_iso_open.png`.
4. Update page text (section 3 table, notes) and commit; upload with `rsync -rt --no-perms --no-owner --no-group --omit-dir-times misc/ lxplus:/eos/user/d/dneff/www/misc/`.
5. Check Castorama stock at Palaiseau (not verified: Claude in Chrome tools were not available this session; headless system Chrome works for screenshots).
6. Measure real trap/hose positions and item sizes; update KEEP-OUT zones.

**Gotchas / decisions:**
- Z-up model to Three.js Y-up mapping is (x, y, z) -> (x, z, -y) (proper rotation, keeps winding).
- Blender ortho camera scale must be in metres (the plan view failed until fixed); the plan view was dropped.
- Headless Chrome screenshot shows the animation mid-way under virtual time; use a test copy with `setStep(4)` to check the finished state.
- Varnish sources: Codeve (<10 g/L), Peintagone (max 130 g/L), Comus (max 100 g/L). Water-resistance claims are manufacturer claims, untested. Linseed price €8.79/1 L from the Castorama page; Castorama water-based varnish price not found.
- Phébus linseed sheet suggests thinning with 30–50% turpentine (solvent).
- Castorama: 40×200 cm pine board PPA18400 €16.90; planed 27×27 batten discontinued at Castorama; lamelles collées 27×27 2.5 m listed.
- Dylan's photos are for reference only. Do not publish them on the site.

**Key files & commands:**
- `misc/shelf/build_model.py` — geometry, design checks, writes `model.json`. `python3 misc/shelf/build_model.py`
- `misc/shelf/render_blender.py` — renders. `~/Software/blender-5.1.0-linux-x64/blender -b --factory-startup --python misc/shelf/render_blender.py`
- `misc/shelf/index.html` — review page with Three.js animation (loads `model.json`)
- `misc/README.md` — folder notes
- `scripts/deploy-eos.sh` — PAYLOAD now includes `misc`; full deploy needs kinit and the DAQ watcher stopped (see script header)
