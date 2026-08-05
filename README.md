# dylan-site

Personal research site — a static, self-contained "live CV" with interactive
sketches of each research topic (X17 at n_TOF, Micromegas/PICOSEC, sPHENIX
vernier scans, STAR/QGP). No build step, no external dependencies, no trackers.

## Layout

```
index.html      the whole page
style.css       palette + layout (same dataviz palette as the x17 DAQ stats page)
js/shared.js    theme toggle, canvas/DPR helpers, tooltip
js/x17.js       e+e- opening-angle spectrum (mass & signal sliders)
js/micromegas.js  drift/avalanche/centroid animation
js/vernier.js   beam-overlap + rate-scan demo
js/qgp.js       collision geometry + proton-multiplicity histogram
```

## Preview locally

```
python3 -m http.server -d ~/PycharmProjects/dylan-site 8000
# http://localhost:8000
```

(The "Live from the experiment" pill reads `x17/data.json`, which only exists
on EOS — locally it just shows "status offline".)

## Deploy (CERN EOS web hosting)

The site is served from `/eos/user/d/dneff/www/`. The `x17/` subdirectory
(live DAQ stats) and `trigger_scheme.html` live in the same tree — **copy the
site files individually; do not delete or mirror over the www root**:

```
scp -r ~/PycharmProjects/dylan-site/{index.html,style.css,js} lxplus:/eos/user/d/dneff/www/
```

The live pill and the "Open the live DAQ page" link use the relative path
`x17/`, so they work wherever the www root is served from.

## TODOs before calling it done

- Fill the `.todo`-flagged placeholders: dates in the timeline, undergrad
  institution, ORCID iD, selected publications, thesis title/link.
- Confirm the contact email (`dylan.neff@cern.ch`) is right.
- Optional: a photo in the hero, and a downloadable PDF CV.
