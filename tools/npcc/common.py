"""Shared Blender helpers for the track C pipeline."""
import bpy, bmesh, mathutils, math


def load(path, drop=()):
    """Import a glb, apply all transforms, return list of mesh objects (Z-up, metres, feet at z=0, centred, facing -Y)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in list(meshes):
        if any(d.lower() in o.name.lower() for d in drop):
            bpy.data.objects.remove(o); meshes.remove(o)
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        o.data = o.data.copy()  # single user
        o.data.transform(mw)
        o.matrix_world = mathutils.Matrix.Identity(4)
    for o in [o for o in bpy.data.objects if o.type != 'MESH']:
        bpy.data.objects.remove(o)
    lo, hi = bounds(meshes)
    size = hi - lo
    # metres: a person is 1.5-2.0 tall
    s = 1.0
    if size.z > 20: s = 0.01
    t = mathutils.Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    for o in meshes:
        o.data.transform(mathutils.Matrix.Scale(s, 4) @ t)
    return meshes


def bounds(meshes):
    lo = mathutils.Vector((1e9,) * 3); hi = -lo
    for o in meshes:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = mathutils.Vector(map(min, lo, w)); hi = mathutils.Vector(map(max, hi, w))
    return lo, hi


def render(path, meshes, res=512, side=False):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'; sc.cycles.samples = 8; sc.cycles.use_denoising = False
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1)
    sc.render.resolution_x = res; sc.render.resolution_y = res
    lo, hi = bounds(meshes)
    cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = max(hi.z - lo.z, hi.x - lo.x) * 1.05
    co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co)
    cz = (lo.z + hi.z) / 2
    if side:
        co.location = (5, 0, cz); co.rotation_euler = (math.pi / 2, 0, math.pi / 2)
    else:
        co.location = (0, -5, cz); co.rotation_euler = (math.pi / 2, 0, 0)
    sc.camera = co
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(co)
