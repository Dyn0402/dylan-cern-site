# Handoff

## Under-sink shelf (misc/shelf) — updated 2026-10-16 (dylan-MS-7C84)

**Resume:** Fix the left/right and front/back placement of the items against Dylan's photos (he says the model is confused about these), then re-render and redeploy.

**Goal:** Two-shelf under-sink shelf for Dylan's cabinet in Palaiseau. Shows the design, Blender renders, a Three.js assembly animation, the varnish comparison and the Castorama shopping check, on the public site under `/misc/shelf/`.

**Done:**
- v2–v4: triangular, then trapezoid design with flat back; trap and dishwasher hose removed from the model (v5), since they are not part of the design.
- v5: middle shelf underside 300 mm, top shelf underside 500 mm (top at 518 mm, 82 mm below the basin bottom). Post cut list 3×300 + 3×182 mm (1446 mm total, one 2.4 m batten).
- v5: the four stored items at their measured sizes (see Photos below).
- Materials chosen: 27×27 mm pine corner batten `baguette d'angle rabotée pin 27 × 27 mm, 2.4 m` at €8.69 (the 27×27 lamelles are discontinued); screws `vis à bois inox A2 Pozidriv 4×40 mm, 200 pièces` at €19.90 (about 30 needed); boiled linseed oil, two weeks' cure in the cellar.
- v6 (latest, commit `9c4acd0`): a 500 mm wide pocket left of the 400 mm door opening, with its back wall 500 mm further back; basin offset 15 mm to the left; detergents pushed to the back; bags pushed back and centred left-right; rinse bottle at the back of the pocket.
- Deployed to EOS with `./scripts/deploy-eos.sh` after v5, v5b and v6. Live: https://dylan-neff.web.cern.ch/misc/shelf/

**In progress / where it stopped:**
- **Left/right and front/back are wrong in the model.** Dylan says the previous turns were confused about these. The bottle was placed "back-left" in model coordinates, but in the render and to Dylan it reads as front/right. Re-check every item against the photos before changing numbers.
- The left pocket's width (500 mm) and depth (back wall 500 mm further back) are a reading of "about 50 cm", not confirmed by Dylan.
- The counter top still stops at x = −418; the shelves do not extend into the pocket.
- Basin top margin is 82 mm (the check was relaxed from 100 to 80 mm to fit the 50 cm height). Needs checking against the basin fittings.
- The bag roll is hidden behind the top shelf in the iso_open render, so check the front render too.

**Next steps:**
1. Re-read the user's messages (below) and the three photos in `~/Downloads/` before editing anything. Ask Dylan rather than assuming an orientation.
2. Fix item placement in `build_model.py` (`ITEM_BOX` and the `items` list in `build()`). Run `python3 misc/shelf/build_model.py` (its checks must pass), then render with `~/Software/blender-5.1.0-linux-x64/blender -b --factory-startup --python misc/shelf/render_blender.py`.
3. Update the page text in `misc/shelf/index.html` (the render note, section 3 and the captions) to match.
4. Commit, push, then `./scripts/deploy-eos.sh` (needs a Kerberos ticket: `kinit dneff@CERN.CH`). Check the live `model.json` with curl.

**Gotchas / decisions:**
- Units are mm. "50 cm" = 500 mm. For two turns the left space was set to 50 mm by mistake; it is now `LEFT_SPACE = 500` and `BACK_LEFT = 500`.
- Axes: x < 0 is the open left side (toward the door hinge), y = 0 is the main back wall, y = 500 is the open door front, z up. The render camera is at the front-left, so model −x appears on the **image right**. Don't reason about left/right from the render; reason from the photos and Dylan's words.
- Heights are underside-of-board for the shelves, and the floor is z = 0. Under the middle shelf there is 300 mm of clearance.
- Items are checked by `build_model.py` against posts, shelves and each other. A bad placement fails the build (tested).
- The old `TOP_M = 100` basin margin was relaxed to 80 mm to fit the 50 cm height Dylan asked for.

**Dylan's last messages, verbatim:**

> Please put in real positions on the shelf if they fit and we'll have to redesign if not. ... Remove trap/hose entirely (if that's what the black think on right side is). ... Let's stick with linseed, 2 weeks no problem in cellar. ... What about screws? ... Size them based on the battens, I assume?

> Ok the bottle should be on the left in the back. Currently, its in the front right in front of the stand. For the detergents, this is fine, just push them both all the way to the back. For the garbage bag also push into the back but keep in the middle left-right. Please model that space to the left. It's more space under the sink, the door gives access to only these 40cm but it goes back further by about 50 cm on the left and we have much more back there. In addition, please also offset the sink basin in that direction (to the left) by about 15mm. Please dobule check the pickture in ~/Downloads to get a better idea

> Ok I'd like to stand that blue detergent box up vertically. Can we try making the middle shelf 30cm off the ground and then the top shelf 20cm above that (50cm total)? Then, put the detergents vertically on the bottom and the garbage bags on the middle shelf vertically. Bottle is good, just push to back of the scene rather than have it by the door. Also, what is the status of that ~50cm of extra space to the left?

> Ok, you clearly are confused about what I mean by left/right and front back. Please copy my last few messages along with this one to a handoff for a smarter model then /wrap-up

**Photos (Dylan's, `~/Downloads/`, 2026-10-16):**
- `PXL_20261016_114604648.jpg`: front view of the items on the mat with a tape measure. Blue box = Carrefour Expert Classic salt, 4 × 1 kg (the "big blue detergent box", 24 × 17 × 10 cm). Red box = Sun Expert Plus tablets ×40 (the "smaller red box", 18 × 20 × 7 cm). Rinse bottle = Sun rinse aid, 39 cm tall. Bin bags 15 cm long × 7 cm diameter.
- `PXL_20261016_114611303.jpg`: top-down of the same items; the bottle is lying down in this shot.
- `PXL_20261016_112917169.jpg`: the cabinet from the front with the door open. The sink basin sits toward the left wall, the drain pipe and dishwasher hose are at the back-centre, and a clear bottle is taped to the back-right wall.

**Key files & commands:**
- `misc/shelf/build_model.py` — geometry source; `python3 misc/shelf/build_model.py` writes `model.json` and runs the checks
- `misc/shelf/model.json` — read by `index.html` at load time (`fetch("model.json")`)
- `misc/shelf/render_blender.py` — renders `renders/shelf_{iso,iso_open,front}.png`
- `misc/shelf/index.html` — the page (Three.js animation, design table, cut list, Castorama check, varnish comparison)
- `./scripts/deploy-eos.sh` — deploys the site (`misc` is in PAYLOAD)
