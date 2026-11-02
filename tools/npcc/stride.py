"""Stride test: pose a built character mid-stride (thighs apart, a knee bent, arms down) and render
front and side, to see how robes and skirts deform between the legs.

    blender -b --factory-startup --python tools/npcc/stride.py -- work/ID.glb OUT_PREFIX [T]
"""
import bpy, sys, os, math, mathutils
sys.path.insert(0, os.path.dirname(__file__))
import common

a = sys.argv[sys.argv.index('--') + 1:]
src, out = a[0], a[1]
tpose = len(a) > 2 and a[2] == 'T'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = [o for o in bpy.data.objects if o.type == 'MESH']


def turn(name, axis, deg):
    pb = rig.pose.bones.get(name)
    if not pb:
        return
    pb.rotation_mode = 'QUATERNION'
    w = (rig.matrix_world.to_3x3() @ pb.bone.matrix_local.to_3x3())
    local = w.inverted() @ mathutils.Vector(axis)
    pb.rotation_quaternion = mathutils.Quaternion(local.normalized(), math.radians(deg)) @ pb.rotation_quaternion


# Blender world after glTF import: Z up, the character faces -Y, his left is +X.
turn('LeftUpLeg', (1, 0, 0), -32)
turn('RightUpLeg', (1, 0, 0), 22)
turn('RightLeg', (1, 0, 0), 35)
if tpose:
    turn('LeftArm', (0, 1, 0), 72)
    turn('RightArm', (0, 1, 0), -72)
turn('RightArm', (1, 0, 0), -20)
turn('LeftArm', (1, 0, 0), 20)
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
for o in mesh:  # bake the posed shape so bounds and render agree
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    o.modifiers.clear(); o.data = me; o.parent = None; o.matrix_world = mathutils.Matrix.Identity(4)
    for v in me.vertices:
        pass
rig.hide_render = True
common.render(out + '_f.png', mesh, res=768)
common.render(out + '_s.png', mesh, res=768, side=True)
