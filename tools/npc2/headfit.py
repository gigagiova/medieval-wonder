"""
A scanned head on a MakeHuman body (build.py).

The MakeHuman face is a fair average; the Renderpeople scans (CC BY 4.0, see
public/models/npc/CREDITS.md) are real people photographed. So the body's
head is reshaped into the scanned one, and the scan's photographed skin is
baked onto it:

  fit(basemesh, spec)    before anything is fitted to the body: the scan is
                         brought onto the body's head (a similarity transform
                         that puts its eyes on the body's eyes, scaled by the
                         eyes' spacing and the eyes' height over the neck),
                         then the head's surface is drawn onto the scan's
                         (projected along its normals, the moves smoothed
                         over the mesh, twice), fading out down the neck.
                         Stored as the "scanfit" shape key, so hoods, veils
                         and the rig's head joints are fitted to the new head.
  bake(basemesh, spec)   after cleanup: the eye holes are closed (the scan's
                         eyes are in its skin), the head gets its own UV
                         layout and the scan's albedo (and normal detail) is
                         baked onto it from the scan's surface.
"""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

SCANS = os.environ.get('NPC2_SCANS', '')
# Face-only scans: their landmarks in their photograph (u, v from the top-left).
SCAN_LANDMARKS = {
    'face_grandpa': {'eyeL': (0.69, 0.37), 'eyeR': (0.33, 0.37), 'mouthL': (0.585, 0.695), 'mouthR': (0.405, 0.695), 'nose': (0.5, 0.53)},
}
HEAD_BONES = ('Head', 'Neck', 'LeftEye', 'RightEye', 'HeadJaw', 'HeadJawEnd', 'HeadMouthLeft', 'HeadMouthRight',
              'HeadEyelidLeft', 'HeadEyelidRight', 'HeadBrowLeft', 'HeadBrowRight', 'HeadTop_End')


def log(*a):
    print('NPC2 head', *a, flush=True)


class Scan:
    """The scanned body, imported, in its bind pose; its head's surface."""

    def __init__(self, name):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(SCANS, name + '.gltf'))
        self.objs = [o for o in bpy.data.objects if o not in before]
        self.mesh = next(o for o in self.objs if o.type == 'MESH' and len(o.data.vertices) > 1000)
        self.arm = next((o for o in self.objs if o.type == 'ARMATURE'), None)
        if self.arm:
            self.arm.data.pose_position = 'REST'
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        me = self.mesh.evaluated_get(dg).to_mesh()
        mw = self.mesh.matrix_world
        self.co = [mw @ v.co for v in me.vertices]
        if self.arm is None:
            # A face-only scan (fetch-faces.ts: no rig, no eyeballs): all of it
            # is head; its landmarks are where they are in its photograph.
            self.dom = ['Head'] * len(self.co)
            self.head = [True] * len(self.co)
            self.bvh = BVHTree.FromPolygons(self.co, [tuple(p.vertices) for p in me.polygons])
            uvs = [Vector((0, 0)) for _ in self.co]
            cnt = [0] * len(self.co)
            for l in me.loops:
                uvs[l.vertex_index] += me.uv_layers.active.data[l.index].uv
                cnt[l.vertex_index] += 1
            uvs = [u / max(1, c) for u, c in zip(uvs, cnt)]
            self.mesh.evaluated_get(dg).to_mesh_clear()
            at = lambda u, v: self.co[min(range(len(uvs)), key=lambda i: (uvs[i] - Vector((u, 1 - v))).length)]
            L = SCAN_LANDMARKS[name]
            # Eye centres: a little behind the surface of the eye (the scan looks along -Y).
            back = Vector((0, 0.011, 0))
            self.eyeL, self.eyeR = at(*L['eyeL']) + back, at(*L['eyeR']) + back
            if self.eyeL.x < self.eyeR.x:
                self.eyeL, self.eyeR = self.eyeR, self.eyeL
            self.mouthL, self.mouthR = at(*L['mouthL']), at(*L['mouthR'])
            if self.mouthL.x < self.mouthR.x:
                self.mouthL, self.mouthR = self.mouthR, self.mouthL
            self.nose = at(*L['nose'])
            em = (self.eyeL + self.eyeR) / 2
            self.neck = em - Vector((0, 0, 0.16))
            log('scan', name, 'face only', 'eyes', fmt(self.eyeL), fmt(self.eyeR), 'nose', fmt(self.nose))
            return
        names = {g.index: g.name for g in self.mesh.vertex_groups}
        dom = []
        for v in self.mesh.data.vertices:
            best = max(v.groups, key=lambda g: g.weight, default=None)
            dom.append(names.get(best.group, '') if best else '')
        self.dom = dom
        self.head = [dom[i] in HEAD_BONES for i in range(len(dom))]
        polys = [tuple(p.vertices) for p in me.polygons if all(self.head[i] for i in p.vertices)]
        self.bvh = BVHTree.FromPolygons(self.co, polys)
        self.mesh.evaluated_get(dg).to_mesh_clear()
        eye = lambda n: centroid([self.co[i] for i, d in enumerate(dom) if d == n])
        self.eyeL, self.eyeR = eye('LeftEye'), eye('RightEye')
        if self.eyeL.x < self.eyeR.x:  # Blender: the body's left is +X
            self.eyeL, self.eyeR = self.eyeR, self.eyeL
        self.neck = self.arm.matrix_world @ self.arm.data.bones['Neck'].head_local
        bone = lambda n: self.arm.matrix_world @ self.arm.data.bones[n].head_local
        self.mouthL, self.mouthR = bone('HeadMouthLeft'), bone('HeadMouthRight')
        if self.mouthL.x < self.mouthR.x:
            self.mouthL, self.mouthR = self.mouthR, self.mouthL
        hv = [self.co[i] for i in range(len(self.co)) if self.head[i] and dom[i] not in ('LeftEye', 'RightEye')]
        em = (self.eyeL + self.eyeR) / 2
        self.nose = min((p for p in hv if abs(p.x - em.x) < 0.02 and em.z - 0.07 < p.z < em.z - 0.01), key=lambda p: p.y)
        log('scan', name, 'eyes', fmt(self.eyeL), fmt(self.eyeR), 'neck', fmt(self.neck))

    def transform(self, M):
        """Move the scan (its armature root) by M; refresh its surface."""
        root = self.arm or self.mesh
        while root.parent:
            root = root.parent
        root.matrix_world = M @ root.matrix_world
        bpy.context.view_layer.update()
        self.co = [M @ p for p in self.co]
        self.eyeL, self.eyeR, self.neck = M @ self.eyeL, M @ self.eyeR, M @ self.neck
        self.mouthL, self.mouthR, self.nose = M @ self.mouthL, M @ self.mouthR, M @ self.nose
        polys = [tuple(p.vertices) for p in self.mesh.data.polygons if all(self.head[i] for i in p.vertices)]
        self.bvh = BVHTree.FromPolygons(self.co, polys)

    def remove(self):
        for o in self.objs:
            bpy.data.objects.remove(o, do_unlink=True)


def fmt(v):
    return tuple(round(x, 3) for x in v)


def centroid(ps):
    c = Vector()
    for p in ps:
        c += p
    return c / max(1, len(ps))


def group_centroid(obj, co, name):
    gi = obj.vertex_groups[name].index
    return centroid([co[v.index] for v in obj.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)])


def mix_coords(obj):
    """The basemesh's current shape (all its shape keys mixed)."""
    obj.shape_key_add(name='tmpmix', from_mix=True)
    kb = obj.data.shape_keys.key_blocks['tmpmix']
    co = [obj.matrix_world @ p.co for p in kb.data]
    obj.shape_key_remove(kb)
    return co


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def fit(basemesh, spec):
    scan = Scan(spec['scan'])
    co = mix_coords(basemesh)
    eyeL = group_centroid(basemesh, co, 'helper-l-eye')
    eyeR = group_centroid(basemesh, co, 'helper-r-eye')
    neck = group_centroid(basemesh, co, 'joint-neck')
    em, sm = (eyeL + eyeR) / 2, (scan.eyeL + scan.eyeR) / 2
    s1 = (eyeL - eyeR).length / (scan.eyeL - scan.eyeR).length
    s2 = (em.z - neck.z) / (sm.z - scan.neck.z)
    s = min(1.1, max(0.9, s1)) * spec.get('scan_scale', 1.0)
    # Turn about Z so the scan's eye line lies along the body's.
    a = math.atan2((eyeL - eyeR).y, (eyeL - eyeR).x) - math.atan2((scan.eyeL - scan.eyeR).y, (scan.eyeL - scan.eyeR).x)
    M = Matrix.Translation(em) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Scale(s, 4) @ Matrix.Translation(-sm)
    scan.transform(M)
    log('similarity scale', round(s1, 3), round(s2, 3), 'turn', round(math.degrees(a), 1))

    # Body surface vertices (not helpers) in the head and neck, and their weights.
    me = basemesh.data
    body = basemesh.vertex_groups['body'].index
    is_body = [any(g.group == body for g in v.groups) for v in me.vertices]
    z_full, z_none = neck.z + 0.065, neck.z - 0.005
    w = [smoothstep(z_none, z_full, co[i].z) if is_body[i] else 0.0 for i in range(len(co))]
    nb = [set() for _ in me.vertices]
    for e in me.edges:
        i, j = e.vertices
        if is_body[i] and is_body[j]:
            nb[i].add(j)
            nb[j].add(i)
    # Normals of the current shape.
    tmp = bmesh.new()
    tmp.from_mesh(me)
    tmp.verts.ensure_lookup_table()
    for i, v in enumerate(tmp.verts):
        v.co = co[i]
    tmp.normal_update()
    nrm = [v.normal.copy() for v in tmp.verts]
    tmp.free()

    # Inside surfaces (the mouth's cavity, nostrils, ear canals): a ray out
    # along their normal meets the head again. They are not projected; they
    # just follow the surface round them.
    polys = [tuple(p.vertices) for p in me.polygons if all(is_body[i] for i in p.vertices)]
    own = BVHTree.FromPolygons(co, polys)
    inner = [False] * len(co)
    for i in range(len(co)):
        if w[i] > 0:
            h = own.ray_cast(co[i] + nrm[i] * 0.002, nrm[i], 0.12)
            inner[i] = h[0] is not None
    # Eye sockets: MakeHuman's eyes are separate balls in deep sockets; here
    # the socket is laid onto the scan's eye, looking from in front.
    # How much a vertex is laid on the scan from in front rather than along
    # its normal: fully in the socket, fading out over the lids.
    sock = [0.0] * len(co)
    for i in range(len(co)):
        if w[i] > 0:
            de = min((co[i] - eyeL).length, (co[i] - eyeR).length)
            sock[i] = 1 - smoothstep(0.013, 0.026, de)
            if sock[i] > 0.5:
                inner[i] = False
    log('inner', sum(inner), 'socket', sum(1 for x in sock if x > 0))

    # Landmarks: the mouth's corners and the nose's tip moved onto the
    # scan's (the eyes already coincide), the head round them following
    # (Gaussian-weighted, fading to nothing 6 cm away).
    inn = [co[i] for i in range(len(co)) if inner[i] and em.z - 0.10 < co[i].z < em.z - 0.06 and abs(co[i].x - em.x) < 0.04]
    fy = min(p.y for p in inn)
    lip = [p for p in inn if p.y < fy + 0.01]
    mL, mR = max(lip, key=lambda p: p.x), min(lip, key=lambda p: p.x)
    nose = min((co[i] for i in range(len(co)) if is_body[i] and abs(co[i].x - em.x) < 0.02 and em.z - 0.07 < co[i].z < em.z - 0.01), key=lambda p: p.y)
    marks = [(eyeL, Vector()), (eyeR, Vector()), (mL, scan.mouthL - mL), (mR, scan.mouthR - mR), (nose, scan.nose - nose)]
    log('landmarks', [(fmt(a), fmt(d)) for a, d in marks])
    sig2 = 2 * 0.03 ** 2
    pos = list(co)
    for i in range(len(co)):
        if w[i] <= 0:
            continue
        acc, ws = Vector(), 0.25
        for L, d in marks:
            g = math.exp(-(co[i] - L).length_squared / sig2)
            acc += d * g
            ws += g
        pos[i] = co[i] + acc / ws * w[i]
    # The head drawn onto the scan's surface.
    for it in range(3):
        delta = [Vector() for _ in pos]
        conf = [0.0] * len(pos)
        for i in range(len(pos)):
            if w[i] <= 0 or inner[i]:
                continue
            p, n = pos[i], nrm[i]
            best = None
            front = None
            if sock[i] > 0:
                h = scan.bvh.ray_cast(p + Vector((0, -0.06, 0)), Vector((0, 1, 0)), 0.1)
                if h[0] is not None:
                    front = h[0] - p
                if sock[i] >= 1 and front is not None:
                    delta[i] = front
                    conf[i] = 1.0
                    continue
            for d in (n, -n):
                h = scan.bvh.ray_cast(p, d, 0.04)
                if h[0] is not None and (best is None or h[3] < best[3]):
                    best = h
            if best is None:
                h = scan.bvh.find_nearest(p, 0.02)
                if h[0] is not None:
                    best = h
            if best is not None:
                delta[i] = best[0] - p
                conf[i] = 1.0
            if front is not None:
                delta[i] = delta[i].lerp(front, sock[i]) if best is not None else front
                conf[i] = 1.0
        # Smooth the moves over the surface (outliers and misses filled in).
        for _ in range(12 if it < 2 else 4):
            nd = []
            for i in range(len(pos)):
                if w[i] <= 0:
                    nd.append(delta[i])
                    continue
                acc, ws = delta[i] * (conf[i] * 2.0), conf[i] * 2.0
                for j in nb[i]:
                    acc += delta[j] * max(conf[j], 0.25)
                    ws += max(conf[j], 0.25)
                nd.append(acc / ws if ws > 0 else delta[i])
            delta = nd
        for i in range(len(pos)):
            if w[i] > 0:
                pos[i] = pos[i] + delta[i] * w[i]
    # Helpers in the head (eyes, teeth, joints) follow the nearest surface vertices.
    kd = KDTree(len(pos))
    for i in range(len(pos)):
        if is_body[i] and w[i] > 0:
            kd.insert(co[i], i)
    kd.balance()
    for i in range(len(pos)):
        if not is_body[i] and co[i].z > z_none:
            near = kd.find_n(co[i], 6)
            if near:
                acc, ws = Vector(), 0.0
                for (_, j, d) in near:
                    ww = 1 / (d + 1e-3)
                    acc += (pos[j] - co[j]) * ww
                    ws += ww
                pos[i] = co[i] + acc / ws
    key = basemesh.shape_key_add(name='scanfit', from_mix=False)
    mwi = basemesh.matrix_world.inverted()
    basis = basemesh.data.shape_keys.key_blocks[0]
    for i, p in enumerate(pos):
        # The key's offset over the basis is what the head moved by.
        key.data[i].co = basis.data[i].co + mwi.to_3x3() @ (p - co[i])
    key.value = 1.0
    basemesh['npc2_scan_M'] = [x for row in M for x in row]
    scan.remove()
    log('fitted', sum(1 for x in w if x > 0), 'verts')


def close_eyes(basemesh, scan, headz):
    """Fill the eye holes (boundary loops on the head), a centre vertex in
    each fan, the new vertices laid on the scan's eyes and weighted as the
    lids round them."""
    me, mw = basemesh.data, basemesh.matrix_world
    mwi = mw.inverted()
    bm = bmesh.new()
    bm.from_mesh(me)
    deform = bm.verts.layers.deform.active
    edges = [e for e in bm.edges if e.is_boundary and all((mw @ v.co).z > headz for v in e.verts)]
    if not edges:
        bm.free()
        return 0
    rim = {v for e in edges for v in e.verts}
    res = bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    poked = bmesh.ops.poke(bm, faces=res['faces'])
    new = [v for v in poked['verts']]
    # A second ring between centre and rim, for the eye's curvature.
    spokes = [e for e in bm.edges if any(v in new for v in e.verts) and any(v in rim for v in e.verts)]
    sub = bmesh.ops.subdivide_edges(bm, edges=spokes, cuts=1)
    new += [g for g in sub['geom_inner'] if isinstance(g, bmesh.types.BMVert)]
    fwd = Vector((0, -1, 0))
    for v in new:
        p = mw @ v.co
        h = scan.bvh.ray_cast(p + fwd * 0.05, -fwd, 0.1)
        if h[0] is not None:
            v.co = mwi @ h[0]
        near = min(rim, key=lambda r: (r.co - v.co).length)
        dl = v[deform]
        dl.clear()
        for gi, wt in near[deform].items():
            dl[gi] = wt
    bm.to_mesh(me)
    bm.free()
    me.update()
    return len(new)


def bake(basemesh, spec, out_dir, size=1024):
    """Close the eye holes, lay the head out on its own UVs, and bake the
    scan's skin onto it. The head faces get material 'head' (its own image);
    the body's painted skin is matched in tone to the scanned neck."""
    M = Matrix([basemesh['npc2_scan_M'][i * 4:i * 4 + 4] for i in range(4)])
    scan = Scan(spec['scan'])
    scan.transform(M)
    me, mw = basemesh.data, basemesh.matrix_world
    rig = basemesh.parent
    bonez = lambda n: (rig.matrix_world @ rig.data.bones['mixamorig:' + n].head_local).z
    neckz, headz = bonez('Neck'), bonez('Head')
    log('closed eyes', close_eyes(basemesh, scan, headz))

    # Head faces (above the base of the neck) get their own material and
    # their UVs (MakeHuman's head island) stretched over the whole image.
    cut = neckz - 0.02
    head_faces = [p for p in me.polygons if (mw @ p.center).z > cut]
    hidx = {p.index for p in head_faces}
    # Their UV islands packed afresh over the whole image (MakeHuman's own
    # layout kept aside, to blend the neck into the painted body skin).
    mhuv = me.uv_layers.new(name='mhuv', do_init=True)
    me.uv_layers.active = me.uv_layers[0]
    for p in me.polygons:
        p.select = p.index in hidx
    bpy.ops.object.select_all(action='DESELECT')
    basemesh.select_set(True)
    bpy.context.view_layer.objects.active = basemesh
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    skin = basemesh.active_material
    head = bpy.data.materials.new('head')
    head.use_nodes = True
    img = bpy.data.images.new('head_albedo', size, size, alpha=False)
    img.generated_color = (0.6, 0.45, 0.38, 1)
    nt = head.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.nodes.active = tex  # (linked to the shader only after the bake: no circular dependency)
    me.materials.append(head)
    hi = len(me.materials) - 1
    for p in [me.polygons[i] for i in hidx]:
        p.material_index = hi
    # During the bake the skin's own image must not be written to.
    dummy = bpy.data.images.new('dummy', 8, 8)
    st = skin.node_tree
    dn = st.nodes.new('ShaderNodeTexImage')
    dn.image = dummy
    st.nodes.active = dn

    sc_ = bpy.context.scene
    sc_.render.engine = 'CYCLES'
    sc_.cycles.device = 'CPU'
    sc_.cycles.samples = 1
    bk = sc_.render.bake
    bk.use_selected_to_active = True
    bk.cage_extrusion = 0.02
    bk.max_ray_distance = 0.05
    bk.margin = 8
    bk.use_pass_direct = False
    bk.use_pass_indirect = False
    bk.use_pass_color = True
    # Only the basemesh's own armature pose (rest) matters: bake in rest.
    rig.data.pose_position = 'REST'
    bpy.ops.object.select_all(action='DESELECT')
    scan.mesh.select_set(True)
    basemesh.select_set(True)
    bpy.context.view_layer.objects.active = basemesh
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True,
                        cage_extrusion=0.02, max_ray_distance=0.05, margin=8)
    # Where the scan is to be used: a mask baked like the colour.
    mask = bpy.data.images.new('head_mask', size, size, alpha=False)
    mm = bpy.data.materials.new('skinmask')
    mm.use_nodes = True
    # (The scans' per-vertex skin likeness is too coarse on some faces to
    # judge by: the whole head is taken, but for the collar below.)
    mx = mm.node_tree.nodes.new('ShaderNodeValue')
    mx.outputs[0].default_value = 1.0
    # ...and nothing of the scan below the jaw's shadow on the neck (a collar
    # sits there on most): the neck is continued from the skin above it.
    geo = mm.node_tree.nodes.new('ShaderNodeNewGeometry')
    sep = mm.node_tree.nodes.new('ShaderNodeSeparateXYZ')
    rng = mm.node_tree.nodes.new('ShaderNodeMapRange')
    zc = neckz + spec.get('collar', 0.045)
    rng.inputs['From Min'].default_value, rng.inputs['From Max'].default_value = zc - 0.012, zc + 0.012
    mul = mm.node_tree.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    L = mm.node_tree.links
    L.new(geo.outputs['Position'], sep.inputs[0])
    L.new(sep.outputs['Z'], rng.inputs['Value'])
    L.new(rng.outputs['Result'], mul.inputs[0])
    L.new(mx.outputs[0], mul.inputs[1])
    L.new(mul.outputs['Value'], mm.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    old_mats = list(scan.mesh.data.materials)
    for i in range(len(scan.mesh.data.materials)):
        scan.mesh.data.materials[i] = mm
    tex.image = mask
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True,
                        cage_extrusion=0.02, max_ray_distance=0.05, margin=8)
    for i, m in enumerate(old_mats):
        scan.mesh.data.materials[i] = m
    tex.image = img
    # The scan's atlas is padded with a flat colour (fetch-people.ts) that
    # shows round its eyeballs where they meet the lids: masked out too.
    imgs = [n.image for m in scan.mesh.data.materials for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
    alb = next((i for i in imgs if 'albedo' in i.name), None) or next(i for i in imgs if 'normal' not in i.name and 'rough' not in i.name)
    w0 = alb.size[0]
    bg = list(alb.pixels[(2 * w0 + 2) * 4:(2 * w0 + 2) * 4 + 3])
    transfer(basemesh, hidx, scan, alb, img)
    alpha = fill_non_skin(img, mask, bg)
    nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    body_img = match_body_tone(basemesh, skin, img, hidx, zc, alpha)
    under_scan(basemesh, hidx, body_img, img, alpha)
    blend_neck(basemesh, hidx, body_img, img, zc)
    me.uv_layers.remove(me.uv_layers['mhuv'])
    img.filepath_raw = os.path.join(out_dir, basemesh.name.split('.')[0] + '_head.png')
    img.file_format = 'PNG'
    img.save()
    st.nodes.remove(dn)
    st.nodes.active = next(n for n in st.nodes if n.type == 'TEX_IMAGE')
    rig.data.pose_position = 'POSE'
    scan.remove()
    log('baked', img.filepath_raw)
    return img


def fill_non_skin(img, mask, bg=None):
    """Pixels that are not the scan's skin (or not baked at all) filled by
    push-pull from the skin round them: a smooth continuation of its tone."""
    import numpy as np
    n = img.size[0]
    a = np.array(img.pixels[:], dtype=np.float32).reshape(n, n, 4)[..., :3]
    m = np.array(mask.pixels[:], dtype=np.float32).reshape(n, n, 4)[..., 0]
    alpha = np.clip((m - 0.45) / 0.25, 0, 1)
    alpha[a.sum(-1) < 0.02] = 0  # unbaked background
    if bg is not None:
        # Exactly the padding's colour, and flat round about (skin of a
        # similar tone has texture; the padding has none).
        flat = np.abs(a - np.array(bg, np.float32)[None, None, :]).max(-1) < 0.012
        p = np.pad(a, ((2, 2), (2, 2), (0, 0)), mode='edge')
        var = sum(np.abs(p[2 + dy:2 + dy + n, 2 + dx:2 + dx + n] - a).max(-1) for dy in (-2, 0, 2) for dx in (-2, 0, 2))
        flat &= var < 0.03
        alpha[flat] = 0
        log('atlas padding masked', int(flat.sum()), 'px')
    # Pyramid of premultiplied colour and weight.
    levels = []
    c, wgt = a * alpha[..., None], alpha.copy()
    while c.shape[0] > 4:
        levels.append((c, wgt))
        h = c.shape[0] // 2
        c = c.reshape(h, 2, h, 2, 3).sum((1, 3))
        wgt = wgt.reshape(h, 2, h, 2).sum((1, 3))
    fill = c / np.maximum(wgt, 1e-6)[..., None]
    def up2(x):
        # Bilinear-ish: repeat, then a 3x3 box blur.
        u = np.repeat(np.repeat(x, 2, 0), 2, 1)
        p = np.pad(u, ((1, 1), (1, 1), (0, 0)), mode='edge')
        return sum(p[i:i + u.shape[0], j:j + u.shape[1]] for i in range(3) for j in range(3)) / 9.0
    for c, wgt in reversed(levels):
        up = up2(fill)
        k = np.clip(wgt, 0, 1)[..., None]
        fill = (c / np.maximum(wgt, 1e-6)[..., None]) * k + up * (1 - k)
    # Far from any skin (more than ~10 px, where image neighbours are other
    # islands, e.g. the lips beside the neck), the scan's median skin tone.
    good = alpha > 0.9
    lum = a.mean(-1)
    sk = a[good & (lum > np.percentile(lum[good], 40)) & (lum < np.percentile(lum[good], 90))]
    med = np.median(sk, 0) if len(sk) else np.array([0.6, 0.45, 0.38])
    near = alpha.copy()
    for _ in range(10):
        p = np.pad(near, 1, mode='edge')
        near = np.maximum(alpha, np.maximum.reduce([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]]) * 0.9)
    k = np.clip(near, 0, 1)[..., None]
    fill = fill * k + med[None, None, :] * (1 - k)
    out = np.concatenate([fill, np.ones((n, n, 1), np.float32)], -1)
    img.pixels[:] = out.ravel()
    return alpha
    log('filled', round(float((alpha < 0.5).mean()), 3), 'of the head image')


def match_body_tone(basemesh, skin, head_img, hidx, zc, alpha):
    """Scale the painted body skin's colour so that its neck and shoulders
    average what the scanned skin of the face does. Mostly a change of
    lightness; the hue moves at most 18%."""
    import numpy as np
    me = basemesh.data
    body_img = next(n.image for n in skin.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.name != 'dummy' and 'normal' not in n.image.name.lower())
    huv, muv = me.uv_layers[0].data, me.uv_layers['mhuv'].data
    n = head_img.size[0]
    hp = np.array(head_img.pixels[:], dtype=np.float32).reshape(n, n, 4)
    W, H = body_img.size
    bp = np.array(body_img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    hs, bs = np.zeros(3), np.zeros(3)
    samples = []
    k = kb = 0
    mw = basemesh.matrix_world
    for p in me.polygons:
        if p.index not in hidx:
            # The painted skin of the neck and shoulders, just below the head's material.
            if zc - 0.2 < (mw @ p.center).z < zc:
                for li in p.loop_indices:
                    mu, mv = muv[li].uv
                    bs += bp[min(H - 1, max(0, int(mv * H))), min(W - 1, max(0, int(mu * W))), :3]
                    kb += 1
            continue
        for li in p.loop_indices:
            u, v = huv[li].uv
            x, y = min(n - 1, max(0, int(u * n))), min(n - 1, max(0, int(v * n)))
            if alpha[y, x] < 0.9:
                continue
            samples.append(hp[y, x, :3])
            k += 1
    # The face's skin: not its hair, brows or shadows (the brighter middle of its texels).
    S = np.array(samples) if samples else np.ones((1, 3)) * 0.6
    lum = S.mean(1)
    lo, hi = np.percentile(lum, 40), np.percentile(lum, 92)
    hs = S[(lum >= lo) & (lum <= hi)].mean(0)
    bs /= max(1, kb)
    kc = hs / np.maximum(bs, 1e-3)
    kl = hs.mean() / max(bs.mean(), 1e-3)
    kc = np.clip(kl * np.clip(kc / kl, 0.82, 1.18), 0.4, 1.8)
    px = bp.reshape(-1, 4).copy()
    px[:, :3] = np.clip(px[:, :3] * kc, 0, 1)
    new = bpy.data.images.new('body_skin', W, H, alpha=False)
    new.pixels[:] = px.ravel()
    new.pack()
    for nd in skin.node_tree.nodes:
        if nd.type == 'TEX_IMAGE' and nd.image == body_img:
            nd.image = new
    log('body tone x', [round(float(x), 3) for x in kc], 'from', k, 'texels')
    return new


def blend_neck(basemesh, hidx, body_img, head_img, zc, width=0.035):
    """Below the collar line the head image takes the (tone-matched) painted
    body skin, texel for texel through MakeHuman's own UVs, fading into the
    scanned skin over `width` above it: no seam where the head's material
    meets the body's."""
    import numpy as np
    me, mw = basemesh.data, basemesh.matrix_world
    huv, muv = me.uv_layers[0].data, me.uv_layers['mhuv'].data
    n = head_img.size[0]
    out = np.array(head_img.pixels[:], dtype=np.float32).reshape(n, n, 4)
    W, H = body_img.size
    src = np.array(body_img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    me.calc_loop_triangles()
    k = 0
    for t in me.loop_triangles:
        if t.polygon_index not in hidx:
            continue
        zs = [(mw @ me.vertices[v].co).z for v in t.vertices]
        if min(zs) > zc + width:
            continue
        D = np.array([[huv[l].uv.x * n, huv[l].uv.y * n] for l in t.loops])
        S = np.array([[muv[l].uv.x, muv[l].uv.y] for l in t.loops])
        raster(out, D, S, src, lambda l1, l2, l3: 1 - np.clip((l1 * zs[0] + l2 * zs[1] + l3 * zs[2] - zc) / width, 0, 1))
        k += 1
    head_img.pixels[:] = out.ravel()
    log('neck blended over', k, 'triangles')


def raster(out, D, S, src, weight=None):
    """Draw one triangle into `out` (n x n x 4): D its corners in pixels, S
    the same corners' UVs in `src`, sampled bilinearly; `weight(l1, l2, l3)`
    (barycentric) blends it over what is there."""
    import numpy as np
    n = out.shape[0]
    H, W = src.shape[:2]
    x0, y0 = np.floor(D.min(0)).astype(int) - 1
    x1, y1 = np.ceil(D.max(0)).astype(int) + 1
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, n - 1), min(y1, n - 1)
    if x1 < x0 or y1 < y0:
        return
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    (ax, ay), (bx, by), (cx, cy) = D
    det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(det) < 1e-9:
        return
    l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / det
    l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / det
    l3 = 1 - l1 - l2
    e = -0.6 / max(1.0, abs(det) ** 0.5)
    inside = (l1 >= e) & (l2 >= e) & (l3 >= e)
    if not inside.any():
        return
    su = l1 * S[0][0] + l2 * S[1][0] + l3 * S[2][0]
    sv = l1 * S[0][1] + l2 * S[1][1] + l3 * S[2][1]
    px = np.clip(su * W - 0.5, 0, W - 1.001)
    py = np.clip(sv * H - 0.5, 0, H - 1.001)
    ix, iy = px.astype(int), py.astype(int)
    fx, fy = (px - ix)[..., None], (py - iy)[..., None]
    col = (src[iy, ix] * (1 - fx) * (1 - fy) + src[iy, ix + 1] * fx * (1 - fy)
           + src[iy + 1, ix] * (1 - fx) * fy + src[iy + 1, ix + 1] * fx * fy)
    yy, xx = np.nonzero(inside)
    if weight is None:
        out[yy + y0, xx + x0, :3] = col[yy, xx, :3]
    else:
        wgt = np.clip(weight(l1, l2, l3), 0, 1)[yy, xx][:, None]
        out[yy + y0, xx + x0, :3] = out[yy + y0, xx + x0, :3] * (1 - wgt) + col[yy, xx, :3] * wgt

def transfer(basemesh, hidx, scan, alb, img):
    """Colour by correspondence round the eyes. Each head vertex already lies on the scan's
    surface (fit()), so it has a place in the scan's own texture: every head
    triangle is drawn into the head image straight from the scan's atlas,
    interpolating those places — no rays, so no smearing where the head's
    normals turn about (the eyes, the lips' corners). Triangles whose
    corners fall in different islands of the scan's atlas keep the ray bake."""
    import numpy as np
    from mathutils.geometry import barycentric_transform
    dg = bpy.context.evaluated_depsgraph_get()
    se = scan.mesh.evaluated_get(dg)
    sm = se.to_mesh()
    suv = sm.uv_layers.active.data
    sm.calc_loop_triangles()
    tris = [t for t in sm.loop_triangles if all(scan.head[v] for v in t.vertices)]
    from mathutils.bvhtree import BVHTree
    co = scan.co
    tree = BVHTree.FromPolygons(co, [tuple(t.vertices) for t in tris])
    tuv = [[suv[l].uv.copy() for l in t.loops] for t in tris]
    tco = [[co[v] for v in t.vertices] for t in tris]
    se.to_mesh_clear()

    me, mw = basemesh.data, basemesh.matrix_world
    huv = me.uv_layers.active.data
    me.calc_loop_triangles()
    vuv = {}
    def scan_uv(vi):
        if vi not in vuv:
            p = mw @ me.vertices[vi].co
            loc, nrm, ti, d = tree.find_nearest(p, 0.01)
            if loc is None:
                vuv[vi] = None
            else:
                a, b, c = tco[ti]
                ua, ub, uc = (Vector((u.x, u.y, 0)) for u in tuv[ti])
                vuv[vi] = barycentric_transform(loc, a, b, c, ua, ub, uc).to_2d()
        return vuv[vi]
    eyes = (scan.eyeL, scan.eyeR)
    n = img.size[0]
    out = np.array(img.pixels[:], dtype=np.float32).reshape(n, n, 4)
    W, H = alb.size
    src = np.array(alb.pixels[:], dtype=np.float32).reshape(H, W, 4)
    done = 0
    for t in me.loop_triangles:
        if t.polygon_index not in hidx:
            continue
        c3 = mw @ me.polygons[t.polygon_index].center
        if min((c3 - e).length for e in eyes) > 0.03:
            continue
        S = [scan_uv(v) for v in t.vertices]
        if any(x is None for x in S):
            continue
        if max((S[0] - S[1]).length, (S[1] - S[2]).length, (S[0] - S[2]).length) > 0.04:
            continue
        D = np.array([[huv[l].uv.x * n, huv[l].uv.y * n] for l in t.loops])
        x0, y0 = np.floor(D.min(0)).astype(int) - 1
        x1, y1 = np.ceil(D.max(0)).astype(int) + 1
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, n - 1), min(y1, n - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = D
        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(det) < 1e-9:
            continue
        l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / det
        l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / det
        l3 = 1 - l1 - l2
        e = -0.6 / max(1.0, abs(det) ** 0.5)  # (a little over the edge: no cracks)
        inside = (l1 >= e) & (l2 >= e) & (l3 >= e)
        if not inside.any():
            continue
        su = l1 * S[0].x + l2 * S[1].x + l3 * S[2].x
        sv = l1 * S[0].y + l2 * S[1].y + l3 * S[2].y
        px = np.clip(su * W - 0.5, 0, W - 1.001)
        py = np.clip(sv * H - 0.5, 0, H - 1.001)
        ix, iy = px.astype(int), py.astype(int)
        fx, fy = (px - ix)[..., None], (py - iy)[..., None]
        col = (src[iy, ix] * (1 - fx) * (1 - fy) + src[iy, ix + 1] * fx * (1 - fy)
               + src[iy + 1, ix] * (1 - fx) * fy + src[iy + 1, ix + 1] * fx * fy)
        yy, xx = np.nonzero(inside)
        out[yy + y0, xx + x0, :3] = col[yy, xx, :3]
        done += 1
    img.pixels[:] = out.ravel()
    log('transferred', done, 'triangles from the scan atlas')


def under_scan(basemesh, hidx, body_img, head_img, alpha):
    """Where the scan has no skin to give (inside the ears, a face-only scan's
    scalp, under a collar), the painted body skin, tone-matched, texel for
    texel through MakeHuman's own UVs; the scan over it, its edge softened."""
    import numpy as np
    me = basemesh.data
    huv, muv = me.uv_layers[0].data, me.uv_layers['mhuv'].data
    n = head_img.size[0]
    cur = np.array(head_img.pixels[:], dtype=np.float32).reshape(n, n, 4)
    base = cur.copy()
    W, H = body_img.size
    src = np.array(body_img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    me.calc_loop_triangles()
    for t in me.loop_triangles:
        if t.polygon_index not in hidx:
            continue
        D = np.array([[huv[l].uv.x * n, huv[l].uv.y * n] for l in t.loops])
        S = np.array([[muv[l].uv.x, muv[l].uv.y] for l in t.loops])
        raster(base, D, S, src)
    a = alpha.copy()
    # Soften the scan's edge over ~16 texels (three box blurs), keeping it
    # inside the scan: the painted skin fades in only where the scan ends.
    def box(x, r):
        c = np.cumsum(np.pad(x, ((r + 1, r), (0, 0)), mode='edge'), 0)
        x = (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)
        c = np.cumsum(np.pad(x, ((0, 0), (r + 1, r)), mode='edge'), 1)
        return (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
    for _ in range(3):
        a = box(a, 5)
    a = np.clip((a - 0.5) * 2, 0, 1) * alpha
    a = a[..., None]
    out = cur * a + base * (1 - a)
    out[..., 3] = 1
    head_img.pixels[:] = out.ravel()
    log('painted skin under the scan where it has none:', round(float((alpha < 0.5).mean()), 3))
