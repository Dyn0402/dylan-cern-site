#!/usr/bin/env python3
"""Geometry for the under-sink 2-tier triangular shelf (v2).

    python3 misc/shelf/build_model.py     # writes misc/shelf/model.json

Everything is in millimetres, Z up. Cabinet interior is x in [-400, 0],
y in [0, 400] (back wall y=0, right wall x=0), z in [0, 550].

Both the Blender renders (render_blender.py) and the animated HTML page read
model.json, so the two cannot drift apart.
"""

import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent

# --- design constants (mm) ---------------------------------------------------
LEG = 27            # square post section (27x27 batten)
T = 18              # shelf board thickness
SIDE = 380          # triangle legs (right isosceles): 38 x 38 cm
Z_LOW = 120         # underside of lower shelf above the floor
Z_UP = 482          # underside of upper shelf (top of structure = 500)
TOP = Z_UP + T      # 500
CAB = dict(x0=-400, x1=0, y0=0, y1=400, z0=0, z1=550)

# Triangle: right angle in the back-right corner, legs along back wall and right wall.
A = (0.0, 0.0)              # right angle, wall corner
B = (-float(SIDE), 0.0)     # along back wall
C = (0.0, float(SIDE))      # along right wall


def post_xy():
    """Posts sit fully under the shelf, inset from each triangle corner so the
    square stays inside the 45-degree acute corners."""
    s = LEG
    # corner A: flush against both walls
    a = (-s, 0.0)
    # corner B (acute): square against back wall, outer edge kept inside hypotenuse
    b = (-SIDE + s, 0.0)
    # corner C (acute): square against right wall
    c = (-s, SIDE - 2 * s)
    return [(a, "A"), (b, "B"), (c, "C")]


def check_inside():
    """Every post corner must lie inside the triangle (y >= 0, x <= 0, y - x <= SIDE)."""
    for (x0, y0), name in post_xy():
        for dx, dy in [(0, 0), (LEG, 0), (0, LEG), (LEG, LEG)]:
            x, y = x0 + dx, y0 + dy
            assert y >= -1e-9 and x <= 1e-9 and y - x <= SIDE + 1e-9, (name, x, y)


def box(x0, y0, z0, dx, dy, dz):
    """Axis-aligned box as (vertices, faces); faces use CCW outward winding."""
    x1, y1, z1 = x0 + dx, y0 + dy, z0 + dz
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2), (0, 2, 1), (4, 5, 6), (4, 6, 7),
         (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5),
         (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    return v, f


def triangle_prism(z0, z1):
    """Triangular slab A-B-C between heights z0 and z1."""
    pts = [A, B, C]
    v = [(x, y, z0) for x, y in pts] + [(x, y, z1) for x, y in pts]
    f = [(0, 2, 1), (3, 4, 5)]               # bottom (flipped) and top
    for i in range(3):                       # three side quads -> two tris each
        j = (i + 1) % 3
        f += [(i, j, j + 3), (i, j + 3, i + 3)]
    return v, f


def part(pid, label, kind, mesh, z_final, explode, step):
    v, f = mesh
    return dict(id=pid, label=label, kind=kind,
                verts=[list(p) for p in v], faces=[list(t) for t in f],
                explode=list(explode), step=step)


def build():
    check_inside()
    parts = []
    # step 1: base posts stand on the floor
    for i, ((x, y), name) in enumerate(post_xy()):
        mesh = box(x, y, 0, LEG, LEG, Z_LOW)
        parts.append(part(f"base{name}", f"Base post {name}", "post", mesh, 0,
                          (0, 0, 380), 1))
    # step 2: lower shelf on base posts
    parts.append(part("shelfLow", "Lower shelf", "shelf",
                      triangle_prism(Z_LOW, Z_LOW + T), Z_LOW,
                      (0, 0, 340), 2))
    # step 3: middle posts on lower shelf
    for (x, y), name in post_xy():
        mesh = box(x, y, Z_LOW + T, LEG, LEG, Z_UP - (Z_LOW + T))
        parts.append(part(f"mid{name}", f"Middle post {name}", "post", mesh,
                          Z_LOW + T, (0, 0, 380), 3))
    # step 4: upper shelf on middle posts
    parts.append(part("shelfUp", "Upper shelf", "shelf",
                      triangle_prism(Z_UP, TOP), Z_UP,
                      (0, 0, 340), 4))
    return dict(units="mm", cabinet=CAB, triangle=dict(A=A, B=B, C=C, side=SIDE),
                height=TOP, parts=parts)


if __name__ == "__main__":
    model = build()
    out = HERE / "model.json"
    out.write_text(json.dumps(model, indent=1))
    print("wrote", out, "parts:", len(model["parts"]),
          "posts:", [p["id"] for p in model["parts"] if p["kind"] == "post"])
    print("hypotenuse mm:", round(SIDE * 2 ** 0.5, 1), " height:", TOP)
