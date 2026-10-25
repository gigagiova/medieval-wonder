"""
Cloaks and shawls, modelled here as cloth (build.py): there is no fitted
MakeHuman asset for an early-medieval cloak, so one is cut and draped.

  1. The body's arms are lowered to hang at its sides (the bind pose is an
     A-pose; a cloak draped over raised arms would tent).
  2. The cloth is cut as a ring segment round the base of the neck: a short
     top edge (the collar, pinned), widening out over the shoulders and then
     falling straight, so its hem is long, as a semicircular cloak's is.
  3. Blender's cloth solver drops it onto the body and the garments under it
     (collision objects), wool-like: heavy, little stretch, soft bending.
  4. It takes the skin weights of the body under it (nearest surface,
     interpolated), smoothed out over the cloth so it moves as a whole;
     the lower part also follows the thighs a little, so a striding leg
     pushes the hem rather than passing through it.
  5. It is un-posed back into the bind pose (the inverse of its own
     skinning), so it is skinned to the rig like every other garment.
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix


def log(*a):
    print('NPC2 drape', *a, flush=True)


def bone_world(rig, n):
    return rig.matrix_world @ rig.data.bones['mixamorig:' + n].head_local


def lower_arms(rig, angle):
    """Pose: upper arms swung down by `angle` (radians) about the body's forward axis."""
    for side, sgn in (('Left', 1), ('Right', -1)):
        pb = rig.pose.bones['mixamorig:%sArm' % side]
        pb.rotation_mode = 'QUATERNION'
        # The rotation in armature space, expressed in the bone's local frame.
        R = Matrix.Rotation(sgn * angle, 4, 'Y')  # Blender: forward is -Y; arms out along ±X
        B = pb.bone.matrix_local
        pb.rotation_quaternion = (B.inverted() @ R @ B).to_quaternion()
    bpy.context.view_layer.update()


def make(gid, g, garments, basemesh, rig):
    d = g['drape']
    sc = bpy.context.scene
    # The whole body collides: MPFB's masks hiding it under the fitted clothes are off meanwhile.
    masks = [m for m in basemesh.modifiers if m.type == 'MASK' and m.name.startswith('Delete')]
    for m in masks:
        m.show_viewport = False
    lower_arms(rig, math.radians(d.get('arms', 38)))
    neck = bone_world(rig, 'Neck')
    sh = (bone_world(rig, 'LeftArm') + bone_world(rig, 'RightArm')) / 2
    # Cut: rings (top: the collar) x columns round the neck.
    a0, a1 = math.radians(d['from']), math.radians(d['to'])  # 0 = the body's right, counter-clockwise seen from above
    ncol, nrow = d.get('cols', 56), d.get('rows', 36)
    r0, r1 = d.get('collar', 0.095), d.get('reach', 0.36)
    z0 = neck.z - 0.025
    drop = d['length']
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    grid = []
    # The cut starts out already hanging: each column of it follows the
    # body's (and the garments under it) outline as seen from the neck's
    # axis, a little clear of it, falling straight down from the widest point
    # above (as cloth hangs from the shoulders), from the collar to the hem.
    # The solver then only has to settle it into its folds.
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for c in [basemesh] + [garments[c] for c in d.get('over', []) if c in garments]:
        ce = c.evaluated_get(dg)
        cm = ce.to_mesh()
        off = len(verts)
        verts += [c.matrix_world @ v.co for v in cm.vertices]
        polys += [tuple(off + i for i in p.vertices) for p in cm.polygons]
        ce.to_mesh_clear()
    hull = BVHTree.FromPolygons(verts, polys)
    gap = d.get('gap', 0.02)
    H = drop + 0.1
    nz = 80
    cols = []
    for i in range(ncol + 1):
        a = a0 + (a1 - a0) * i / ncol
        dirn = Vector((-math.cos(a), -math.sin(a), 0))
        prof = [Vector((neck.x, neck.y, z0)) + dirn * r0]
        rmax = r0
        for k in range(1, nz + 1):
            z = z0 - H * k / nz
            c = Vector((neck.x, neck.y, z))
            hit = hull.ray_cast(c + dirn * 0.8, -dirn, 0.8)
            r = (0.8 - hit[3]) if hit[0] is not None else 0.0
            rmax = max(rmax, r + gap + 0.02 * k / nz)
            prof.append(c + dirn * rmax)
        # Resampled at equal steps along it, to the cloak's length.
        L = [0.0]
        for k in range(1, len(prof)):
            L.append(L[-1] + (prof[k] - prof[k - 1]).length)
        tot = min(L[-1], d['length'] + (rmax - r0))
        col = []
        for j in range(nrow + 1):
            sj = tot * j / nrow
            k = next((k for k in range(1, len(L)) if L[k] >= sj), len(L) - 1)
            f = (sj - L[k - 1]) / max(1e-9, L[k] - L[k - 1])
            col.append(prof[k - 1].lerp(prof[k], min(1.0, f)))
        # Folds: the cloth gathered at the collar falls in soft tubes,
        # deeper towards the hem (irregularly spaced, as wool hangs).
        A, nf = d.get('folds', 0.03), d.get('nfolds', 15)
        ph = nf * a + 0.9 * math.sin(3.1 * a + 0.5) + 0.5 * math.sin(7.3 * a)
        for j in range(1, len(col)):
            t = j / nrow
            col[j] = col[j] + dirn * (A * t ** 1.4 * (0.5 + 0.5 * math.sin(ph)))
        cols.append(col)
    total = sum((cols[len(cols) // 2][j + 1] - cols[len(cols) // 2][j]).length for j in range(nrow))
    for j in range(nrow + 1):
        grid.append([bm.verts.new(cols[i][j]) for i in range(ncol + 1)])
    for j in range(nrow):
        for i in range(ncol):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uv].uv = (ii / ncol * (a1 - a0) * 0.25 / 1.2, 1 - jj / nrow * total / 1.2)
    me = bpy.data.meshes.new('G_' + gid)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('G_' + gid, me)
    bpy.context.scene.collection.objects.link(o)
    pin = o.vertex_groups.new(name='pin')
    pin.add([i for i in range(ncol + 1)], 1.0, 'REPLACE')
    if d.get('pin_rows', 0) > 1:
        pin.add([j * (ncol + 1) + i for j in range(1, d['pin_rows']) for i in range(ncol + 1)], 1.0, 'REPLACE')

    # Collision: the posed body and the garments it lies over.
    colliders = [basemesh] + [garments[c] for c in d.get('over', []) if c in garments]
    for c in colliders:
        m = c.modifiers.new('collide', 'COLLISION')
        c.collision.thickness_outer = 0.012
        c.collision.cloth_friction = 8
    cl = o.modifiers.new('cloth', 'CLOTH')
    s = cl.settings
    s.quality = 6
    s.mass = 0.4
    s.tension_stiffness = s.compression_stiffness = 40
    s.shear_stiffness = 20
    s.bending_stiffness = d.get('bend', 0.6)
    s.air_damping = 2.0
    s.vertex_group_mass = 'pin'
    cs = cl.collision_settings
    cs.distance_min = 0.008
    cs.use_self_collision = d.get('self', False)
    cs.collision_quality = 4
    cl.point_cache.frame_start, cl.point_cache.frame_end = 1, max(2, d.get('frames', 70))
    import os
    if os.environ.get('NPC2_DRAPE_DEBUG'):
        bpy.ops.wm.save_as_mainfile(filepath=os.environ['NPC2_DRAPE_DEBUG'] + '_' + gid + '_init.blend', copy=True)
    for f in range(1, d.get('frames', 70) + 1):
        sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    posed = [v.co.copy() for v in o.evaluated_get(dg).to_mesh().vertices]
    o.evaluated_get(dg).to_mesh_clear()
    o.modifiers.remove(cl)
    for c in colliders:
        c.modifiers.remove(c.modifiers['collide'])
    for v, p in zip(o.data.vertices, posed):
        v.co = p
    sc.frame_set(1)
    log(gid, 'draped', len(posed))
    import os
    if os.environ.get('NPC2_DRAPE_DEBUG'):
        bpy.ops.wm.save_as_mainfile(filepath=os.environ['NPC2_DRAPE_DEBUG'] + '_' + gid + '_posed.blend', copy=True)

    # Weights from the posed body, smoothed over the cloth.
    for vg in basemesh.vertex_groups:
        if vg.name.startswith('mixamorig:') and vg.name not in o.vertex_groups:
            o.vertex_groups.new(name=vg.name)
    dt = o.modifiers.new('wt', 'DATA_TRANSFER')
    dt.object = basemesh
    dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.layers_vgroup_select_src = 'ALL'
    dt.layers_vgroup_select_dst = 'NAME'
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='wt')
    # Cloth hanging by the arms took their weights (and the hands'): it is
    # carried by the shoulders and back instead, following the upper arm only
    # a little (`arm_follow`), so a swinging arm pushes it rather than lifting it.
    import re
    kf0 = d.get('arm_follow', 0.3)
    shz = bone_world(rig, 'LeftArm').z
    for v in o.data.vertices:
        ws = {o.vertex_groups[gr.group].name: gr.weight for gr in v.groups}
        # Over the shoulder the cloth goes with the arm's top (or the sleeve under it comes through).
        kf = kf0 + (0.85 - kf0) * max(0.0, min(1.0, 1 - (shz - v.co.z) / 0.15))
        for S in ('Left', 'Right'):
            arm = [n for n in ws if re.match(r'mixamorig:%s(Arm|ForeArm|Hand)' % S, n)]
            tot = sum(ws[n] for n in arm)
            if tot <= 0:
                continue
            for n in arm:
                o.vertex_groups[n].add([v.index], 0.0, 'REPLACE')
            o.vertex_groups['mixamorig:%sArm' % S].add([v.index], tot * kf, 'REPLACE')
            o.vertex_groups['mixamorig:%sShoulder' % S].add([v.index], tot * (1 - kf) * 0.5, 'ADD')
            o.vertex_groups['mixamorig:Spine2'].add([v.index], tot * (1 - kf) * 0.5, 'ADD')
    # Thigh influence on the lower cloth (it follows a striding leg a little).
    lo = min(p.z for p in posed)
    hips = bone_world(rig, 'Hips')
    for v in o.data.vertices:
        p = v.co
        k = max(0.0, min(1.0, (hips.z - 0.1 - p.z) / 0.4)) * d.get('legs', 0.25)
        if k <= 0:
            continue
        side = 'Left' if p.x > hips.x else 'Right'
        ws = {o.vertex_groups[gr.group].name: gr.weight for gr in v.groups}
        tot = sum(ws.values()) or 1
        for n in ws:
            o.vertex_groups[n].add([v.index], ws[n] / tot * (1 - k), 'REPLACE')
        o.vertex_groups['mixamorig:%sUpLeg' % side].add([v.index], k, 'ADD')
    o.vertex_groups.remove(o.vertex_groups['pin'])
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=d.get('smooth', 30))
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Un-pose: bind = (sum w_i M_i)^-1 posed.
    names = {vg.index: vg.name for vg in o.vertex_groups}
    mats = {}
    for pb in rig.pose.bones:
        mats[pb.name] = rig.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted() @ rig.matrix_world.inverted()
    for v in o.data.vertices:
        M = np.zeros((4, 4))
        tw = 0
        for gr in v.groups:
            n = names[gr.group]
            if n in mats and gr.weight > 0:
                M += np.array(mats[n]) * gr.weight
                tw += gr.weight
        if tw <= 0:
            continue
        M /= tw
        p = np.linalg.solve(M, np.array([v.co.x, v.co.y, v.co.z, 1.0]))
        v.co = Vector(p[:3])
    o.data.update()
    # Back to the bind pose; skinned like the rest.
    for side in ('Left', 'Right'):
        rig.pose.bones['mixamorig:%sArm' % side].rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    # Where it is fastened (a fibula, src/npc/props.ts): the collar's end at the right shoulder.
    o['npc2_brooch'] = list(o.matrix_world @ o.data.vertices[ncol].co)
    for m in masks:
        m.show_viewport = True
    o.parent = rig
    am = o.modifiers.new('Armature', 'ARMATURE')
    am.object = rig
    return o
