"""Render the shelf from model.json with Blender (headless Cycles).

    blender -b --factory-startup --python misc/shelf/render_blender.py

Writes misc/shelf/renders/*.png. Units: model is mm; scene is scaled to metres.
"""

import json
import math
import pathlib

import bpy
from mathutils import Vector

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "renders"
S = 0.001  # mm -> m

model = json.loads((HERE / "model.json").read_text())

# --- clean scene -------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, rgb, rough=0.6, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    return m


pine = material("Pine", (0.72, 0.50, 0.28), rough=0.55)
floor_m = material("Floor", (0.45, 0.45, 0.46), rough=0.9)
frame_m = material("CabinetEdge", (0.12, 0.12, 0.12), rough=0.4)


def mesh_object(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x * S, y * S, z * S) for x, y, z in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


# --- shelf parts -------------------------------------------------------------
for p in model["parts"]:
    mesh_object(p["label"], p["verts"], p["faces"], pine)

# --- cabinet outline (edges as thin bars) and floor -------------------------
c = model["cabinet"]
corners = [(x, y, z) for x in (c["x0"], c["x1"]) for y in (c["y0"], c["y1"]) for z in (c["z0"], c["z1"])]
edges = []
for i in range(8):
    for j in range(i + 1, 8):
        a, b = corners[i], corners[j]
        if sum(abs(a[k] - b[k]) for k in range(3)) in (c["x1"] - c["x0"], c["y1"] - c["y0"], c["z1"] - c["z0"]):
            edges.append((a, b))
for n, (a, b) in enumerate(edges):
    va, vb = Vector(a) * S, Vector(b) * S
    d = vb - va
    cyl = bpy.ops.mesh.primitive_cylinder_add(radius=0.004, depth=d.length, location=(va + vb) / 2)
    ob = bpy.context.active_object
    ob.name = f"cab_edge_{n}"
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    ob.data.materials.append(frame_m)

bpy.ops.mesh.primitive_plane_add(size=3.0, location=(-0.2, 0.2, 0))
bpy.context.active_object.data.materials.append(floor_m)

# --- lighting and world --------------------------------------------------------
bpy.ops.object.light_add(type="SUN", location=(0, 0, 3))
sun = bpy.context.active_object
sun.data.energy = 1.0
sun.rotation_euler = (math.radians(45), math.radians(10), math.radians(-35))
bpy.ops.object.light_add(type="AREA", location=(-0.8, 1.2, 1.6))
area = bpy.context.active_object
area.data.energy = 40
area.data.size = 1.2
world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.92, 0.92, 0.93, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25

# --- render settings -----------------------------------------------------------
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Standard"


def camera(name, loc, target, ortho=None):
    cam_data = bpy.data.cameras.new(name)
    if ortho:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = ortho * S
    else:
        cam_data.lens = 35
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = Vector(loc) * S
    direction = Vector(target) * S - cam.location
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = direction.to_track_quat("-Z", "Y")
    return cam


views = {
    # front-left (open side), above: the triangle sits in the back-right corner
    "iso": dict(loc=(-1000, 1500, 900), target=(-130, 150, 260)),
    # straight-on from the open front
    "front": dict(loc=(-200, 1700, 300), target=(-200, 200, 260)),
}

for name, v in views.items():
    cam = camera(name, v["loc"], v["target"], v.get("ortho"))
    scene.camera = cam
    scene.render.filepath = str(OUT / f"shelf_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", scene.render.filepath)
