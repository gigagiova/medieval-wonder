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
# scipy for Blender's Python (tools/npc2/README.md): Blender ignores PYTHONPATH.
import sys as _sys
if os.environ.get('NPC2_PYLIB'):
    _sys.path.append(os.environ['NPC2_PYLIB'])
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


def shorten_neck(basemesh, scan, co):
    """MakeHuman's neck against the scanned person's: the height of the eyes
    over the shoulder joints, in eye spacings. Where the body's is longer,
    the head and the top of the neck are lowered by the difference (a shape
    key, eased in up the neck), so the scanned face doesn't sit on a stalk."""
    if not scan.arm:
        return 0.0
    eyeL = group_centroid(basemesh, co, 'helper-l-eye')
    eyeR = group_centroid(basemesh, co, 'helper-r-eye')
    em = (eyeL + eyeR) / 2
    shb = (group_centroid(basemesh, co, 'joint-l-shoulder').z + group_centroid(basemesh, co, 'joint-r-shoulder').z) / 2
    shs = sum(((scan.arm.matrix_world @ scan.arm.data.bones['%sArm' % S].head_local).z for S in ('Left', 'Right'))) / 2
    rb = (em.z - shb) / (eyeL - eyeR).length
    rs = ((scan.eyeL + scan.eyeR).z / 2 - shs) / (scan.eyeL - scan.eyeR).length
    ex = (rb - rs) * (eyeL - eyeR).length
    log('neck: eyes over shoulders / eye spacing: body', round(rb, 2), 'scan', round(rs, 2), 'excess m', round(ex, 3))
    if ex < 0.008:
        return 0.0
    z0, z1 = shb + 0.03, em.z - 0.09  # base of the neck .. under the jaw
    key = basemesh.shape_key_add(name='neckfit', from_mix=False)
    basis = basemesh.data.shape_keys.key_blocks[0]
    mwi = basemesh.matrix_world.inverted().to_3x3()
    for i, p in enumerate(co):
        k = smoothstep(z0, z1, p.z)
        key.data[i].co = basis.data[i].co + mwi @ Vector((0, 0, -ex * k))
    key.value = 1.0
    return ex


def fit(basemesh, spec):
    scan = Scan(spec['scan'])
    co = mix_coords(basemesh)
    if shorten_neck(basemesh, scan, co) > 0:
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
    # The ears: the scans' are lumpy and half hidden by hair: MakeHuman's
    # are kept, carried along by the head round them.
    ear = [False] * len(co)
    for i in range(len(co)):
        if w[i] > 0 and abs(co[i].x - em.x) > 0.06 and co[i].y > eyeL.y + 0.045 and em.z - 0.08 < co[i].z < em.z + 0.035:
            ear[i] = True
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
    # The head drawn onto the scan's surface, smoothly: a Laplacian surface
    # deformation (Sorkine et al. 2004, "Laplacian Surface Editing") — the
    # head keeps its own shape's differential coordinates (so it cannot fold
    # or crease) while soft constraints pull each vertex towards the nearest
    # point of the scan; constraints that disagree (too far, facing away)
    # are dropped. Repeated a few times, the pull growing; the eye sockets
    # are pulled to the scan from in front; inner surfaces (mouth, nostrils,
    # ear canals) carry no constraint and follow.
    pos = laplacian_fit(me, co, pos, w, inner, sock, nrm, nb, is_body, scan, ear)
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
    log('quality', quality(me, co, pos, [w[i] > 0 for i in range(len(co))]))
    # where the flips are
    where = {}
    for f in me.polygons:
        if not all(w[i] > 0 for i in f.vertices):
            continue
        a, b = poly_normal(co, f), poly_normal(pos, f)
        if a.length > 1e-12 and b.length > 1e-12 and a.dot(b) < 0:
            c = sum((co[i] for i in f.vertices), Vector()) / len(f.vertices)
            k = 'eye' if min((c - eyeL).length, (c - eyeR).length) < 0.03 else 'mouth' if (c - (mL + mR) / 2).length < 0.035 else 'ear' if abs(c.x - em.x) > 0.06 else 'nose' if (c - nose).length < 0.03 else 'inner' if any(inner[i] for i in f.vertices) else 'other'
            where[k] = where.get(k, 0) + 1
    log('flips by place', where)
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
    # The scans' lids are raw and pink round the eye (inner lids, tear
    # ducts, a photographer's flash): reddish texels there are pulled back
    # towards the skin's own hue, keeping their lightness.
    written = np.zeros((n, n), bool)
    for t in me.loop_triangles:
        if t.polygon_index not in hidx:
            continue
        c3 = mw @ me.polygons[t.polygon_index].center
        if min((c3 - e).length for e in eyes) > 0.022:
            continue
        D = np.array([[huv[l].uv.x * n, huv[l].uv.y * n] for l in t.loops])
        x0, y0 = np.clip(np.floor(D.min(0)).astype(int), 0, n - 1)
        x1, y1 = np.clip(np.ceil(D.max(0)).astype(int), 0, n - 1)
        written[y0:y1 + 1, x0:x1 + 1] = True
    rgb = out[..., :3]
    red = rgb[..., 0] / np.maximum(rgb[..., 1], 1e-3)
    ok = written & (red < 1.35) & (rgb.sum(-1) > 0.3)
    skin = np.median(rgb[ok], 0) if ok.any() else np.array([0.6, 0.45, 0.38])
    lum = rgb.mean(-1, keepdims=True)
    tgt = skin[None, None, :] * (lum / max(skin.mean(), 1e-3))
    k = np.clip((red - 1.3) / 0.35, 0, 1)[..., None] * written[..., None] * 0.85
    out[..., :3] = rgb * (1 - k) + tgt * k
    img.pixels[:] = out.ravel()
    log('transferred', done, 'triangles from the scan atlas; lids toned', int((k > 0.1).sum()))


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


def poly_normal(P, f):
    n = Vector()
    vs = [P[i] for i in f.vertices]
    for i in range(len(vs)):
        n += vs[i].cross(vs[(i + 1) % len(vs)])
    return n


def quality(me, A, B, sel):
    """Fit quality: faces flipped, area ratio percentiles, new creases (> 60° between neighbours, < 35° before)."""
    nA, nB, st, flips = {}, {}, [], 0
    for f in me.polygons:
        if not all(sel[i] for i in f.vertices):
            continue
        a, b = poly_normal(A, f), poly_normal(B, f)
        if a.length < 1e-12 or b.length < 1e-12:
            continue
        flips += a.dot(b) < 0
        st.append(b.length / a.length)
        nA[f.index], nB[f.index] = a.normalized(), b.normalized()
    cre = 0
    for e in me.edges:
        pass
    bm = bmesh.new()
    bm.from_mesh(me)
    for e in bm.edges:
        fs = [f.index for f in e.link_faces if f.index in nB]
        if len(fs) == 2 and nB[fs[0]].dot(nB[fs[1]]) < 0.5 and nA[fs[0]].dot(nA[fs[1]]) > 0.82:
            cre += 1
    bm.free()
    st.sort()
    q = lambda p: round(st[int(p * (len(st) - 1))], 2) if st else None
    return {'faces': len(st), 'flips': int(flips), 'creases': cre, 'area p1': q(0.01), 'p50': q(0.5), 'p99': q(0.99), 'max': q(1.0)}


def laplacian_fit(me, co, pos, w, inner, sock, nrm, nb, is_body, scan, ear):
    import numpy as np
    import scipy.sparse as sp
    import scipy.sparse.linalg as sla
    free = [i for i in range(len(co)) if w[i] > 0]
    idx = {v: k for k, v in enumerate(free)}
    n = len(free)
    X0 = np.array([[co[i].x, co[i].y, co[i].z] for i in range(len(co))])
    # Uniform Laplacian over the body's own edges (helpers excluded).
    rows, cols, vals = [], [], []
    for k, i in enumerate(free):
        ns = list(nb[i])
        if not ns:
            rows.append(k); cols.append(k); vals.append(1.0)
            continue
        rows.append(k); cols.append(k); vals.append(1.0)
        for j in ns:
            if j in idx:
                rows.append(k); cols.append(idx[j]); vals.append(-1.0 / len(ns))
    L = sp.csr_matrix((vals, (rows, cols)), shape=(n, n))
    # Differential coordinates of the original head (neighbours outside the region are constants).
    delta = np.zeros((n, 3))
    const = np.zeros((n, 3))
    for k, i in enumerate(free):
        ns = list(nb[i])
        if not ns:
            continue
        delta[k] = X0[i] - X0[ns].mean(0)
        for j in ns:
            if j not in idx:
                const[k] += X0[j] / len(ns)
    rhsL = delta + const
    P = np.array([[pos[i].x, pos[i].y, pos[i].z] for i in free])
    fwd = Vector((0, 1, 0))
    eyeY = min(co[i].y for i in free if sock[i] > 0.9) if any(sock[i] > 0.9 for i in free) else 0.0
    eyeY = (eyeY + sorted(co[i].y for i in free if sock[i] > 0.9)[len([1 for i in free if sock[i] > 0.9]) // 2]) / 2 if eyeY else 0.0
    banned = set()
    face_only = scan.arm is None
    polys = [f for f in me.polygons if all(w[i] > 0 for i in f.vertices)]
    sched = [0.3, 0.6, 1.0, 1.5, 2.5, 2.5, 2.5, 2.5]
    for it, lam in enumerate(sched):
        cw = np.zeros(n)
        T = np.zeros((n, 3))
        # The ears move as a whole with the head round them (per side: the
        # mean move of the non-ear vertices within 5 cm of the ear).
        for side in (1, -1):
            es = [i for i in free if ear[i] and (co[i].x > 0) == (side > 0)]
            if not es:
                continue
            ec = sum((co[i] for i in es), Vector()) / len(es)
            ring = [idx[i] for i in free if not ear[i] and (co[i] - ec).length < 0.05]
            D = (P[ring] - np.array([[co[free[k]].x, co[free[k]].y, co[free[k]].z] for k in ring])).mean(0) if ring else np.zeros(3)
            for i in es:
                T[idx[i]] = X0[i] + D
                cw[idx[i]] = lam
        for k, i in enumerate(free):
            if inner[i] or i in banned or ear[i]:
                continue
            # (A face-only scan has nothing behind the ears.)
            if face_only and co[i].y > eyeY + 0.06:
                continue
            p = Vector(P[k])
            t = None
            if sock[i] > 0.3:
                # Round the eyes only the outer lids, facing forwards, are
                # laid on the scan (from in front); the socket behind them
                # follows, and MakeHuman's eyeballs sit in it.
                if nrm[i].y < -0.5 and co[i].y < eyeY - 0.004:
                    h = scan.bvh.ray_cast(p - fwd * 0.06, fwd, 0.1)
                    t = h[0]
            else:
                loc, nr, _, d = scan.bvh.find_nearest(p, 0.03)
                if loc is not None and nr.dot(nrm[i]) > 0.5:
                    t = loc
            if t is None:
                continue
            T[k] = t
            cw[k] = lam * w[i]
        C = sp.diags(cw)
        A = (L.T @ L + C.T @ C).tocsc()
        solve = sla.factorized(A)
        rhs = L.T @ rhsL + (C.T @ C) @ T
        P = np.stack([solve(rhs[:, c]) for c in range(3)], 1)
        # Where a face has turned over, the pull there is let go (two rings round it) and the pass redone.
        if it >= 4:
            cur = {i: Vector(P[idx[i]]) for i in free}
            get = lambda i: cur.get(i, co[i])
            bad = set()
            for f in polys:
                a = poly_normal(co, f)
                b = poly_normal([None] * 0 or _Proxy(get), f)
                if a.length > 1e-12 and b.length > 1e-12 and a.dot(b) < 0:
                    bad.update(f.vertices)
            for _ in range(2):
                bad |= {j for i in list(bad) for j in nb[i]}
            new_b = bad - banned
            banned |= bad
            log('laplacian pass', it, 'constrained', int((cw > 0).sum()), 'of', n, 'flipped verts released', len(new_b))
            if not new_b and it > 4:
                break
        else:
            log('laplacian pass', it, 'constrained', int((cw > 0).sum()), 'of', n)
    out = list(pos)
    for k, i in enumerate(free):
        out[i] = Vector(P[k])
    return out


class _Proxy:
    """Index -> position, for poly_normal over a dict-backed shape."""
    def __init__(self, f):
        self.f = f
    def __getitem__(self, i):
        return self.f(i)
