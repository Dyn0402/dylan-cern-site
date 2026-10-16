# misc/

Personal projects that are not physics. Deployed to EOS with the rest of the
site (`scripts/deploy-eos.sh` PAYLOAD includes `misc`). Pages are noindex.

## shelf/ — under-sink shelf

- `index.html` — the build review page (assembly animation, renders, design
  notes, varnish comparison, Castorama check). Loads `model.json` and Three.js
  from jsdelivr.
- `model.json` — generated geometry. Regenerate after editing the design:

      python3 misc/shelf/build_model.py

  The script runs design checks (margins, post clearances, keep-out zones) and
  stops with a message if one fails.
- `render_blender.py` — headless Cycles renders to `renders/`:

      ~/Software/blender-5.1.0-linux-x64/blender -b --factory-startup --python misc/shelf/render_blender.py

Measurements (Dylan): opening 400 mm wide, 500 mm deep, floor to basin bottom
600 mm. Trap and hose positions are estimates from a photo. Re-measure before
cutting. The photos Dylan supplied are for reference only and are not on the site.
