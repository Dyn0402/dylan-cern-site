#!/usr/bin/env python3
"""Geometry for the under-sink shelf, v3 (measured cabinet, flat back, raised lower shelf).

    python3 misc/shelf/build_model.py     # checks the design, writes model.json

Units: mm, Z up. Origin = back-right interior corner of the cabinet.
Cabinet interior: x in [-400, 0] (x<0 is towards the open left side),
y in [0, 500] (back wall at y=0, open front at y=500), z in [0, 700].

Measured by Dylan: opening 400 wide, 500 deep, floor to sink basin bottom 600.
Estimated from a photo (MUST be re-measured before cutting): the trap and the
dishwasher hose. The right-hand pipe was removed in v4 (it is not a drain standpipe). They are drawn as keep-out boxes below.

Both render_blender.py and the HTML animation read model.json.
"""

import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent

# --- cabinet ---------------------------------------------------------------
CAB = dict(x0=-400, x1=0, y0=0, y1=500, z0=0, z1=700)
BASIN_Z = 600        # basin bottom above cabinet floor (measured)
COUNTER_Z = 700      # counter underside (estimate)

# --- margins ---------------------------------------------------------------
WALL_M = 15          # shelf edge to side/back wall
FRONT_M = 55         # shelf edge to open front
TOP_M = 100          # upper shelf top to basin bottom

# --- structure -------------------------------------------------------------
LEG = 27             # 27 x 27 batten posts
T = 18               # shelf board thickness
Z_LOW = 200          # underside of lower shelf (storage underneath)
Z_UP = 442           # underside of upper shelf
TOP = Z_UP + T       # 460

# Flat back, steeper front-left slope (plan view, x, y in mm).
# Lower shelf: right-trapezoid, 370 back edge, 200 front edge, 430 deep.
OUTLINE_LOW = [(-15, 15), (-385, 15), (-215, 445), (-15, 445)]
# Upper shelf: same outline (the standpipe and its notch were removed in v4).
OUTLINE_UP = OUTLINE_LOW

# Post lower-left corners (x, y); each post is LEG x LEG.
POSTS = {"R": (-52, 25), "F": (-52, 403), "B": (-360, 25)}

# Estimated keep-out boxes (x0, x1, y0, y1, z0, z1). Measure and update.
# The right-hand pipe is removed: it is not a drain standpipe.
KEEP = {
    "trap":      (-260, -120, 0, 110, 280, 330),
    "hoses":     (-140, -80, 0, 30, 300, 420),
}


# --- geometry helpers ----------------------------------------------------------
def signed_area(poly):
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1]
                     - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))


def point_seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return ((ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2) ** 0.5


def inside(p, poly):
    """Even-odd point-in-polygon."""
    x, y = p
    c = False
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def edge_margin(p, poly):
    return min(point_seg_dist(p, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))


def rect_gap(a, b):
    """Gap between two xy rectangles (x0,x1,y0,y1); 0 if they overlap."""
    gx = max(a[0] - b[1], b[0] - a[1], 0)
    gy = max(a[2] - b[3], b[2] - a[3], 0)
    return max(gx, gy)


def triangulate(poly):
    """Ear clipping. Returns CCW triangles as index triples into poly."""
    idx = list(range(len(poly)))
    if signed_area(poly) < 0:
        idx.reverse()
    tris = []

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    while len(idx) > 3:
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if cross(a, b, c) <= 1e-9:
                continue
            if any(j not in (i0, i1, i2) and _in_tri(poly[j], a, b, c) for j in idx):
                continue
            tris.append((i0, i1, i2))
            del idx[k]
            break
        else:
            raise ValueError("triangulation failed")
    tris.append(tuple(idx))
    return tris


def _in_tri(p, a, b, c):
    def s(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = s(p, a, b), s(p, b, c), s(p, c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def prism(poly, z0, z1):
    """Polygon extruded between z0 and z1. Returns (verts, faces), outward winding."""
    if signed_area(poly) < 0:
        poly = list(reversed(poly))
    n = len(poly)
    v = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
    f = []
    for a, b, c in triangulate(poly):
        f.append((a + n, b + n, c + n))      # top, normal +z
        f.append((a, c, b))                  # bottom, normal -z
    for i in range(n):
        j = (i + 1) % n
        f.append((i, j, j + n))
        f.append((i, j + n, i + n))
    return v, f


def box(x0, x1, y0, y1, z0, z1):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2), (0, 2, 1), (4, 5, 6), (4, 6, 7),
         (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5),
         (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    return v, f


def post_rect(name):
    x0, y0 = POSTS[name]
    return (x0, x0 + LEG, y0, y0 + LEG)


# --- checks -------------------------------------------------------------------
def check():
    problems = []

    def need(ok, msg):
        if not ok:
            problems.append(msg)

    for label, poly in (("lower", OUTLINE_LOW), ("upper", OUTLINE_UP)):
        for x, y in poly:
            need(CAB["x0"] + WALL_M <= x <= CAB["x1"] - WALL_M, f"{label} shelf x={x} too close to side wall")
            need(CAB["y0"] + WALL_M <= y <= CAB["y1"] - FRONT_M, f"{label} shelf y={y} margin to back/front")

    for name in POSTS:
        r = post_rect(name)
        for cx, cy in [(r[0], r[2]), (r[1], r[2]), (r[0], r[3]), (r[1], r[3])]:
            need(inside((cx, cy), OUTLINE_LOW), f"post {name} corner {cx},{cy} outside lower shelf")
            need(inside((cx, cy), OUTLINE_UP), f"post {name} corner {cx},{cy} outside upper shelf")
        need(edge_margin((r[0], r[2]), OUTLINE_UP) >= 8 or edge_margin((r[1], r[3]), OUTLINE_UP) >= 8,
             f"post {name} too close to edge")
        # mid posts run from the lower shelf to the upper shelf
        for kname, (kx0, kx1, ky0, ky1, kz0, kz1) in KEEP.items():
            if kz1 > Z_LOW + T and kz0 < Z_UP:
                gap = rect_gap(r, (kx0, kx1, ky0, ky1))
                need(gap >= 20, f"mid post {name} only {gap:.0f} mm from {kname}")

    # upper shelf clear of the hoses and the standpipe (above hoses)
    hz1 = KEEP["hoses"][5]
    need(Z_UP - hz1 >= 20, "upper shelf too close to dishwasher hose")
    need(BASIN_Z - TOP >= TOP_M, "upper shelf too close to basin")
    need(Z_LOW - KEEP["trap"][5] <= -40 or KEEP["trap"][4] - (Z_LOW + T) >= 40,
         "lower shelf too close to trap")
    return problems


# --- model -------------------------------------------------------------------
def part(pid, label, role, mesh, explode, step):
    v, f = mesh
    return dict(id=pid, label=label, role=role,
                verts=[list(p) for p in v], faces=[list(t) for t in f],
                explode=list(explode), step=step)


def build():
    problems = check()
    if problems:
        raise SystemExit("design checks failed:\n  " + "\n  ".join(problems))

    parts = []
    # assembly parts
    for name in ("B", "R", "F"):
        x0, y0 = POSTS[name]
        parts.append(part(f"base{name}", f"Base post {name}", "post",
                          box(x0, x0 + LEG, y0, y0 + LEG, 0, Z_LOW), (0, 0, 380), 1))
    parts.append(part("shelfLow", "Lower shelf", "shelf",
                      prism(OUTLINE_LOW, Z_LOW, Z_LOW + T), (0, 0, 340), 2))
    for name in ("B", "R", "F"):
        x0, y0 = POSTS[name]
        parts.append(part(f"mid{name}", f"Middle post {name}", "post",
                          box(x0, x0 + LEG, y0, y0 + LEG, Z_LOW + T, Z_UP), (0, 0, 380), 3))
    parts.append(part("shelfUp", "Upper shelf", "shelf",
                      prism(OUTLINE_UP, Z_UP, TOP), (0, 0, 340), 4))

    # context: the space itself (static, not part of the build)
    ctx = [
        ("back", "Back wall", "wall", box(-400, 0, -18, 0, -18, 700)),
        ("right", "Right side", "wall", box(0, 18, 0, 500, 0, 700)),
        ("floor", "Cabinet floor", "wall", box(-400, 0, 0, 500, -18, 0)),
        ("counter", "Counter top", "counter", box(-418, 18, -18, 560, 700, 718)),
        ("basinB", "Basin bottom", "steel", box(-390, -10, 30, 440, BASIN_Z, BASIN_Z + 6)),
        ("basinF", "Basin front", "steel", box(-390, -10, 440, 446, BASIN_Z, COUNTER_Z)),
        ("basinBk", "Basin back", "steel", box(-390, -10, 24, 30, BASIN_Z, COUNTER_Z)),
        ("basinL", "Basin left", "steel", box(-390, -384, 24, 446, BASIN_Z, COUNTER_Z)),
        ("basinR", "Basin right", "steel", box(-16, -10, 24, 446, BASIN_Z, COUNTER_Z)),
    ]
    for pid, label, role, mesh in ctx:
        parts.append(part(pid, label, role, mesh, (0, 0, 0), 0))
    # items for scale: the four things under the sink in the photo, placed in the
    # open front-left corner (outside the shelf footprint), not their real positions
    items = [
        ("bottle", "Rinse aid 1 L (approx. 10 x 10 x 30 cm)", "bottle", (-392, -382, 440, 450, 0, 300)),
        ("roll", "Bin-bag roll (approx. 22 x 22 x 30 cm)", "roll", (-370, -348, 330, 352, 0, 300)),
        ("salt", "Salt 4 x 1 kg (approx. 20 x 10 x 28 cm)", "salt", (-325, -305, 370, 380, 0, 280)),
        ("tabs", "Dishwasher tablets (approx. 21 x 13 x 22 cm)", "tabs", (-396, -375, 365, 378, 0, 220)),
    ]
    for pid, label, role, (x0, x1, y0, y1, z0, z1) in items:
        parts.append(part(pid, label, role, box(x0, x1, y0, y1, z0, z1), (0, 0, 0), 0))
    for name, role in (("trap", "pipe"), ("hoses", "hose")):
        x0, x1, y0, y1, z0, z1 = KEEP[name]
        parts.append(part(name, name.capitalize() + " (estimated)", role,
                          box(x0, x1, y0, y1, z0, z1), (0, 0, 0), 0))

    return dict(units="mm", cabinet=CAB, height=TOP, basin_z=BASIN_Z,
                keep_out={k: list(v) for k, v in KEEP.items()},
                outline_low=OUTLINE_LOW, outline_up=OUTLINE_UP, parts=parts,
                dims=dict(lower_area_mm2=round(0.5 * (370 + 200) * 430),
                          post_cut_mm=3 * 200 + 3 * (Z_UP - Z_LOW - T)))


if __name__ == "__main__":
    model = build()
    out = HERE / "model.json"
    out.write_text(json.dumps(model, indent=1))
    print("checks passed; wrote", out)
    print("lower shelf area cm2:", round(model["dims"]["lower_area_mm2"] / 100),
          " post cut total mm:", model["dims"]["post_cut_mm"])
    print("under-shelf clearance mm:", Z_LOW, " between shelves mm:", Z_UP - Z_LOW - T,
          " top to basin mm:", BASIN_Z - TOP)
