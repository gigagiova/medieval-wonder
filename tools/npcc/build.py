"""Track C townsfolk: already-clothed single-surface characters, auto-rigged in headless Blender.

    blender -b --factory-startup --python tools/npcc/build.py -- ID SRC.glb OUT.glb [debug]

Steps (see tools/npcc/README.md):
1. import the downloaded Sketchfab glb, bake transforms, metres, feet on z=0, facing -Y;
2. multi-part models: hide every triangle that another part covers within 4 cm (ray along
   the normal), join everything into one mesh;
3. decimate to the triangle budget; multi-material models get one atlas (Cycles diffuse-colour
   bake, high to low);
4. fit a Mixamo-named skeleton from landmarks (measured on T-posed meshes, given by hand
   for the others, see SPECS);
5. skin: bone-heat weights computed on a closed voxel-remeshed proxy of the low mesh, then
   transferred to it (nearest face, interpolated), so every layer of cloth gets the same
   weights as the surface around it; long skirts and robes re-weighted to the pelvis and both
   thighs/shins by lateral position away from the legs; smoothed, at most 4 influences;
6. export glb (pack with tools/npcc/pack.ts).
"""
import bpy, bmesh, mathutils, math, sys, os
import numpy as np
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(__file__))
import common
from specs import SPECS

V3 = mathutils.Vector


def join(ms):
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms:
        o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    if len(ms) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data); bm.free()
    return o


def hide_covered(ms, reach=0.04):
    """Delete faces of each part whose vertices are all covered by another part along their normal."""
    trees = {}
    for o in ms:
        bm = bmesh.new(); bm.from_mesh(o.data)
        trees[o.name] = BVHTree.FromBMesh(bm); bm.free()
    for o in ms:
        if any('eye' in n.lower() for n in [o.name] + [m.name for m in o.data.materials]):
            continue  # eyes sit inside the lids: the rays would always hit
        me = o.data
        covered = np.zeros(len(me.vertices), bool)
        for v in me.vertices:
            n = v.normal
            if n.length < 0.5:
                continue
            p = v.co + n * 0.002
            for k, t in trees.items():
                if k == o.name:
                    continue
                hit = t.ray_cast(p, n, reach)
                if hit[0] is not None:
                    covered[v.index] = True
                    break
        bm = bmesh.new(); bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        dead = [f for f in bm.faces if all(covered[v.index] for v in f.verts)]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        bm.to_mesh(me); bm.free()
        print('hide', o.name, int(covered.sum()), 'of', len(covered), 'verts covered;', len(dead), 'faces removed')


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimate(o, tris):
    r = min(1.0, tris / max(1, tri_count(o)))
    m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = r; m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='dec')
    m = o.modifiers.new('tri', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier='tri')


def mat_image(m):
    if m and m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                return n.image
    return None


def grid_atlas(low, size, out_png, boost=None):
    """One material for the low mesh: each source texture copied whole into a square cell of one
    atlas (power-of-two cells by the share of surface each covers, packed as a quadtree), and the
    mesh's own UVs moved into its cell: the artists' UVs and texels are kept."""
    me = low.data
    mats = list(me.materials)
    key = [(mat_image(m).name if mat_image(m) else 'flat:' + (m.name if m else '-')) for m in mats]
    area = {}
    for p in me.polygons:
        m = mats[p.material_index]
        b = max([v for k_, v in (boost or {}).items() if m and k_ in m.name] or [1])
        area[key[p.material_index]] = area.get(key[p.material_index], 0) + p.area * b
    keys = sorted(area, key=lambda k_: -area[k_])
    tot = sum(area.values())
    C = size * 2

    def sizes(f):
        out = {}
        for k_ in keys:
            if k_.startswith('flat:'):
                out[k_] = 16; continue
            want = f * C * math.sqrt(area[k_] / tot)
            s_ = 32
            while s_ * 2 <= min(want, C / 2):
                s_ *= 2
            out[k_] = s_
        return out
    f = 4.0
    while sum(v * v for v in sizes(f).values()) > C * C:
        f *= 0.95
    S = sizes(f)
    free = [(0, 0, C)]  # quadtree free squares
    cell = {}
    for k_ in sorted(keys, key=lambda k_: -S[k_]):
        s_ = S[k_]
        free.sort(key=lambda q: (q[2], q[1], q[0]))
        i = next(i for i, q in enumerate(free) if q[2] >= s_)
        x, y, w = free.pop(i)
        while w > s_:
            w //= 2
            free += [(x + w, y, w), (x, y + w, w), (x + w, y + w, w)]
        cell[k_] = (x, y, s_)
    canvas = np.zeros((C, C, 4), np.float32); canvas[..., 3] = 1
    for k_, (x, y, s_) in cell.items():
        if k_.startswith('flat:'):
            m = bpy.data.materials.get(k_[5:])
            col = list(m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value) if m and m.use_nodes and 'Principled BSDF' in m.node_tree.nodes else [0.4, 0.35, 0.3, 1]
            canvas[y:y + s_, x:x + s_] = col
            continue
        im = bpy.data.images[k_].copy()
        im.scale(s_, s_)
        px = np.empty(s_ * s_ * 4, np.float32); im.pixels.foreach_get(px)
        canvas[y:y + s_, x:x + s_] = px.reshape(s_, s_, 4)
        print('atlas cell', k_, s_, f'{100 * area[k_] / tot:.1f}%')
    uvl = me.uv_layers.active or me.uv_layers[0]
    uv = np.empty(len(me.loops) * 2, np.float32); uvl.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    for p in me.polygons:
        x, y, s_ = cell[key[p.material_index]]
        for li in p.loop_indices:
            u, v = np.clip(uv[li], 0, 1)
            uv[li] = ((x + 1 + u * (s_ - 2)) / C, (y + 1 + v * (s_ - 2)) / C)
    uvl.data.foreach_set('uv', uv.ravel())
    for other in [l for l in me.uv_layers if l != uvl]:
        me.uv_layers.remove(other)
    img = bpy.data.images.new('atlas', C, C)
    img.pixels.foreach_set(canvas.ravel())
    img.filepath_raw = out_png; img.file_format = 'PNG'; img.save()
    img.pack()
    mat = bpy.data.materials.new('atlas'); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    me.materials.clear(); me.materials.append(mat)
    for p in me.polygons:
        p.material_index = 0


def bake_atlas(high, low, size, out_png):
    """One material and one UV atlas for the low mesh, baked from the many materials of the high one."""
    bpy.context.view_layer.objects.active = low
    for uv in list(low.data.uv_layers):
        low.data.uv_layers.remove(uv)
    low.data.uv_layers.new(name='atlas')
    bpy.ops.object.select_all(action='DESELECT'); low.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
    # (Decimation leaves slivers that smart projection packs as far-flung specks, shrinking the rest:
    # same texel density everywhere, then packed afresh.)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=0.002)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new('atlas', size, size)
    mat = bpy.data.materials.new('atlas'); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.95
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.nodes.active = tex
    low.data.materials.clear(); low.data.materials.append(mat)
    for p in low.data.polygons:
        p.material_index = 0
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 1
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True); low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True,
                        cage_extrusion=0.02, max_ray_distance=0.06, margin=6)
    img.filepath_raw = out_png; img.file_format = 'PNG'; img.save()
    img.pack()


# ---------------------------------------------------------------- landmarks

def verts_np(o):
    a = np.empty(len(o.data.vertices) * 3, np.float32)
    o.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def landmarks(o, spec):
    V = verts_np(o)
    H = float(V[:, 2].max())
    k = H / 1.75
    L = {}

    def ymid(zlo, zhi, xr=0.12 * k):
        s = V[(V[:, 2] > zlo) & (V[:, 2] < zhi) & (np.abs(V[:, 0]) < xr)]
        return float((s[:, 1].min() + s[:, 1].max()) / 2) if len(s) else 0.0

    for n, f in [('Hips', 0.53), ('Spine', 0.60), ('Spine1', 0.67), ('Spine2', 0.745), ('Neck', 0.835), ('Head', 0.875)]:
        L[n] = V3((0, ymid(H * f - 0.03, H * f + 0.03), H * f))
    L['HeadTop_End'] = V3((0, L['Head'].y, H))
    for side, s in (('Left', 1), ('Right', -1)):
        # legs
        def leg_at(z, dz=0.015):
            sl = V[(np.abs(V[:, 2] - z) < dz) & (V[:, 0] * s > 0.01)]
            if not len(sl):
                return V3((s * 0.09 * k, 0, z))
            x = float(np.clip(abs(sl[:, 0].mean()), 0.065 * k, 0.12 * k))
            return V3((s * x, float((sl[:, 1].min() + sl[:, 1].max()) / 2), z))
        knee = leg_at(0.285 * H); ank = leg_at(0.055 * H)
        L[side + 'UpLeg'] = V3((s * max(0.085 * k, min(abs(knee.x), 0.1 * k)), L['Hips'].y, 0.50 * H))
        L[side + 'Leg'] = knee
        L[side + 'Foot'] = ank
        ft = V[(V[:, 2] < 0.06 * H) & (V[:, 0] * s > 0.0)]
        toe_y = float(ft[:, 1].min()) if len(ft) else ank.y - 0.17 * k
        toe_y = min(toe_y, ank.y - 0.12 * k)
        L[side + 'ToeBase'] = V3((ank.x, ank.y + 0.65 * (toe_y - ank.y), 0.025 * H))
        L[side + 'Toe_End'] = V3((ank.x, toe_y, 0.02 * H))
        # arms, T-pose: measured slices along x
        if spec.get('pose', 'T') == 'T':
            arm = V[(V[:, 0] * s > 0.15 * k) & (V[:, 2] > 0.62 * H)]
            tip = float(np.abs(arm[:, 0]).max())

            def arm_at(f, r):
                x = f * tip
                sl = arm[np.abs(arm[:, 0] - s * x) < 0.012]
                ztop = float(sl[:, 2].max())
                zbot = float(sl[:, 2].min())
                z = max(ztop - r, (ztop + zbot) / 2) if ztop - zbot > 2 * r else (ztop + zbot) / 2
                near = sl[sl[:, 2] > z - r]
                return V3((s * x, float((near[:, 1].min() + near[:, 1].max()) / 2), z))
            L[side + 'Arm'] = arm_at(0.20, 0.06 * k)
            L[side + 'ForeArm'] = arm_at(0.52, 0.045 * k)
            L[side + 'Hand'] = arm_at(0.80, 0.035 * k)
            L[side + 'HandTip'] = arm_at(0.985, 0.02 * k)
            L[side + 'HandTip'].x = s * tip
        else:  # arms hanging: a starting guess, overridden by spec['marks']
            y = L['Spine2'].y
            L[side + 'Arm'] = V3((s * 0.18 * k, y, 0.815 * H))
            L[side + 'ForeArm'] = V3((s * 0.22 * k, y, 0.63 * H))
            L[side + 'Hand'] = V3((s * 0.24 * k, y - 0.03, 0.485 * H))
            L[side + 'HandTip'] = V3((s * 0.25 * k, y - 0.04, 0.40 * H))
    for key, p in spec.get('marks', {}).items():
        L[key] = V3(p)
        if key.startswith('Left') and 'Right' + key[4:] not in spec.get('marks', {}):
            L['Right' + key[4:]] = V3((-p[0], p[1], p[2]))
    for side, s in (('Left', 1), ('Right', -1)):
        a = L[side + 'Arm']
        L[side + 'Shoulder'] = V3((s * 0.035 * k, a.y + 0.01, a.z - 0.015))
        w, t = L[side + 'Hand'], L[side + 'HandTip']
        L[side + 'HandMiddle1'] = w.lerp(t, 0.5)
    return L, H


BONES = [  # name, parent, tail-from
    ('Hips', None, 'Spine'), ('Spine', 'Hips', 'Spine1'), ('Spine1', 'Spine', 'Spine2'), ('Spine2', 'Spine1', 'Neck'),
    ('Neck', 'Spine2', 'Head'), ('Head', 'Neck', 'HeadTop_End'), ('HeadTop_End', 'Head', None),
]
for S in ('Left', 'Right'):
    BONES += [(S + 'Shoulder', 'Spine2', S + 'Arm'), (S + 'Arm', S + 'Shoulder', S + 'ForeArm'), (S + 'ForeArm', S + 'Arm', S + 'Hand'),
              (S + 'Hand', S + 'ForeArm', S + 'HandMiddle1'), (S + 'HandMiddle1', S + 'Hand', S + 'HandTip'),
              (S + 'UpLeg', 'Hips', S + 'Leg'), (S + 'Leg', S + 'UpLeg', S + 'Foot'), (S + 'Foot', S + 'Leg', S + 'ToeBase'),
              (S + 'ToeBase', S + 'Foot', S + 'Toe_End'), (S + 'Toe_End', S + 'ToeBase', None)]
NODEFORM = {'HeadTop_End', 'LeftToe_End', 'RightToe_End'}


def make_armature(L):
    arm = bpy.data.armatures.new('rig')
    ob = bpy.data.objects.new('rig', arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, parent, tailk in BONES:
        b = arm.edit_bones.new(name)
        b.head = L[name]
        if tailk:
            b.tail = L[tailk]
        else:
            par = L[parent]
            d = (L[name] - par)
            b.tail = L[name] + d.normalized() * 0.05
        if (b.tail - b.head).length < 1e-3:
            b.tail = b.head + V3((0, 0, 0.02))
        if parent:
            b.parent = eb[parent]
        b.use_connect = False
        b.use_deform = name not in NODEFORM
        eb[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def skin(low, rig, voxel):
    """Heat weights on a closed voxel proxy, transferred to the low mesh."""
    bpy.ops.object.select_all(action='DESELECT')
    proxy = low.copy(); proxy.data = low.data.copy(); proxy.name = 'proxy'
    bpy.context.scene.collection.objects.link(proxy)
    proxy.data.remesh_voxel_size = voxel
    bpy.context.view_layer.objects.active = proxy
    bpy.ops.object.voxel_remesh()
    print('proxy verts', len(proxy.data.vertices))
    bpy.ops.object.select_all(action='DESELECT')
    proxy.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    proxy.modifiers.clear()
    for b in rig.data.bones:
        if b.use_deform:
            low.vertex_groups.new(name=b.name)
    m = low.modifiers.new('dt', 'DATA_TRANSFER')
    m.object = proxy; m.use_vert_data = True; m.data_types_verts = {'VGROUP_WEIGHTS'}
    m.vert_mapping = 'POLYINTERP_NEAREST'
    m.layers_vgroup_select_src = 'ALL'; m.layers_vgroup_select_dst = 'NAME'
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = low; low.select_set(True)
    bpy.ops.object.modifier_apply(modifier='dt')
    bpy.data.objects.remove(proxy)


def weights_np(o, names):
    W = np.zeros((len(o.data.vertices), len(names)), np.float32)
    gi = {g.index: names.index(g.name) for g in o.vertex_groups if g.name in names}
    for v in o.data.vertices:
        for g in v.groups:
            if g.group in gi:
                W[v.index, gi[g.group]] = g.weight
    return W


def set_weights(o, names, W):
    for n in names:
        g = o.vertex_groups.get(n)
        if g:
            o.vertex_groups.remove(g)
    gs = [o.vertex_groups.new(name=n) for n in names]
    for i in range(W.shape[0]):
        for j in np.nonzero(W[i] > 1e-4)[0]:
            gs[j].add([i], float(W[i, j]), 'REPLACE')


def seg_dist(P, a, b):
    a = np.array(a); b = np.array(b); d = b - a
    t = np.clip(((P - a) @ d) / (d @ d), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * d), axis=1), t


def skirt(low, L, H, spec):
    """Long skirts and robes: cloth away from the legs follows the pelvis and both legs by its lateral position."""
    names = [g.name for g in low.vertex_groups]
    W = weights_np(low, names)
    P = verts_np(low)
    k = H / 1.75
    ix = {n: i for i, n in enumerate(names)}
    dl, _ = seg_dist(P, L['LeftUpLeg'], L['LeftLeg']); dl2, _ = seg_dist(P, L['LeftLeg'], L['LeftFoot'])
    dr, _ = seg_dist(P, L['RightUpLeg'], L['RightLeg']); dr2, _ = seg_dist(P, L['RightLeg'], L['RightFoot'])
    d = np.minimum.reduce([dl, dl2, dr, dr2])
    z = P[:, 2]
    hipz, kneez, ankz = L['LeftUpLeg'].z, L['LeftLeg'].z, L['LeftFoot'].z
    R = np.interp(z, [ankz, kneez, hipz], [0.06 * k, 0.075 * k, 0.11 * k])
    band = spec.get('skirt_band', 0.07) * k
    t = np.clip((d - R) / band, 0, 1)
    t = t * t * (3 - 2 * t)
    t *= np.clip((hipz + 0.04 - z) / 0.08, 0, 1)  # fades out above the hip joints
    t *= (np.abs(P[:, 0]) < 0.32 * k)  # not the hands and sleeves hanging beside it
    a = np.clip(0.5 + P[:, 0] / (0.22 * k), 0, 1)  # 1 = left
    up = np.clip((z - kneez) / (hipz - kneez), 0, 1)  # 1 at the hips, 0 at the knee
    S = np.zeros_like(W)
    hipw = 0.35 + 0.15 * up
    S[:, ix['Hips']] = hipw
    lw = (1 - hipw)
    S[:, ix['LeftUpLeg']] = lw * a * (0.5 + 0.5 * up)
    S[:, ix['RightUpLeg']] = lw * (1 - a) * (0.5 + 0.5 * up)
    S[:, ix['LeftLeg']] = lw * a * (0.5 - 0.5 * up)
    S[:, ix['RightLeg']] = lw * (1 - a) * (0.5 - 0.5 * up)
    W = W * (1 - t[:, None]) + S * t[:, None]
    print('skirt verts', int((t > 0.5).sum()), 'of', len(t))
    set_weights(low, names, W)


def finish_weights(low):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = low; low.select_set(True)
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=2, expand=0.0)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def debug_render(path, objs, L):
    mat = bpy.data.materials.new('dot'); mat.use_nodes = True
    em = mat.node_tree.nodes.new('ShaderNodeEmission'); em.inputs[0].default_value = (1, 0, 0, 1)
    mat.node_tree.links.new(em.outputs[0], mat.node_tree.nodes['Material Output'].inputs[0])
    dots = []
    for p in L.values():
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.015, location=p, segments=8, ring_count=6)
        d = bpy.context.active_object; d.data.materials.append(mat); d.show_in_front = True; dots.append(d)
    for o in objs:
        o.hide_render = False
    # the joints are inside the body: render them alone and lay them over the body render
    for d in dots:
        d.hide_render = True
    common.render(path + '_f.png', objs, res=768)
    common.render(path + '_s.png', objs, res=768, side=True)
    for d in dots:
        d.hide_render = False
    for o in objs:
        o.hide_render = True
    common.render(path + '_fd.png', objs, res=768)
    common.render(path + '_sd.png', objs, res=768, side=True)
    for o in objs:
        o.hide_render = False
    for d in dots:
        bpy.data.objects.remove(d)


def main():
    a = sys.argv[sys.argv.index('--') + 1:]
    cid, src, out = a[0], a[1], a[2]
    debug = 'debug' in a
    spec = SPECS[cid]
    ms = common.load(src, spec.get('drop', ()))
    lo, hi = common.bounds(ms)
    s = spec['height'] / (hi.z - lo.z)
    for o in ms:
        o.data.transform(mathutils.Matrix.Translation(spec.get('shift', (0, 0, 0))) @ mathutils.Matrix.Scale(s, 4))
    multi = len({(mat_image(m).name if mat_image(m) else m.name) for o in ms for m in o.data.materials}) > 1
    if multi and len(ms) > 1:
        hide_covered(ms)
    high = join(ms)
    high.name = 'high'
    L, H = landmarks(high, spec)
    for k_, v in sorted(L.items()):
        print('L', k_, tuple(round(x, 3) for x in v))
    if debug:
        debug_render(out.replace('.glb', ''), [high], L)
        if debug and 'only' in a:
            return
    if multi:
        low = high; low.name = cid
        decimate(low, spec.get('tris', 12000))
        grid_atlas(low, spec.get('tex', 1024), out.replace('.glb', '_atlas.png'), spec.get('boost'))
    else:
        low = high; low.name = cid
        decimate(low, spec.get('tris', 12000))
    print('tris', tri_count(low))
    rig = make_armature(L)
    skin(low, rig, spec.get('voxel', 0.012) * H / 1.75)
    if spec.get('skirt'):
        skirt(low, L, H, spec)
    finish_weights(low)
    for g in list(low.vertex_groups):
        if g.name in NODEFORM:
            low.vertex_groups.remove(g)
    if not low.parent:
        low.parent = rig
    mod = next((m for m in low.modifiers if m.type == 'ARMATURE'), None) or low.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    for m in low.data.materials:
        m.name = cid
        if m.use_nodes and 'Principled BSDF' in m.node_tree.nodes:
            b = m.node_tree.nodes['Principled BSDF']
            b.inputs['Roughness'].default_value = 0.95; b.inputs['Metallic'].default_value = 0.0
            for l in list(m.node_tree.links):
                if l.to_node == b and l.to_socket.name in ('Roughness', 'Metallic', 'Normal', 'Alpha', 'Emission Color'):
                    m.node_tree.links.remove(l)
    bpy.context.scene['npcc'] = f'{{"id":"{cid}","height":{H:.3f},"sex":"{spec["sex"]}"}}'
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True); low.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_skins=True,
                              export_animations=False, export_morph=False, export_extras=True,
                              export_yup=True, export_image_format='AUTO', export_def_bones=False)
    print('EXPORTED', out)


main()
