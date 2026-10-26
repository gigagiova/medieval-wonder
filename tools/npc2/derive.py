"""Garments derived from the fitted MakeHuman ones (build.py)."""
import bpy, bmesh, math
from mathutils import Vector


def loose_parts(bm):
    seen, parts = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen:
                    seen.add(y.index)
                    stack.append(y)
        parts.append(comp)
    parts.sort(key=lambda c: -len(c))
    return parts


def bone_head(rig, name):
    return rig.matrix_world @ rig.data.bones['mixamorig:' + name].head_local


def make(gid, g, garments, basemesh, rig):
    d = g['derive']
    src = garments[d['from']]
    o = src.copy()
    o.data = src.data.copy()
    o.name = 'G_' + gid
    for c in src.users_collection:
        c.objects.link(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    parts = loose_parts(bm)
    kill = []
    if d['from'] == 'robe_src':
        # Donitz's robe: the gown (largest), the shoulder cape (second), two
        # sleeves, and the rope belt with its knot (the small pieces).
        sizes = [len(p) for p in parts]
        assert sizes[2] == sizes[3] and len(parts) == 7, sizes
        named = {'gown': parts[0], 'capelet': parts[1], 'sleeves': parts[2] + parts[3], 'rope': [v for p in parts[4:] for v in p]}
        keep = d.get('keep')
        for k, vs in named.items():
            if k in d.get('drop', []) or (keep and k not in keep):
                kill += vs
        # The shoulder cape lies on the shoulders: it takes little of the
        # arms' swing (MakeHuman gave it the upper arms' weights, which tear
        # its hem into points when the arms rise).
        if 'capelet' not in d.get('drop', []) and (not keep or 'capelet' in keep):
            dl = bm.verts.layers.deform.active
            gi = {g.name: g.index for g in o.vertex_groups}
            for S in ('Left', 'Right'):
                for nm in ('mixamorig:%sShoulder' % S, 'mixamorig:Spine2'):
                    if nm not in gi:
                        gi[nm] = o.vertex_groups.new(name=nm).index
            arm = {gi[n]: n for n in gi if any(n == 'mixamorig:%s%s' % (S, b) for S in ('Left', 'Right') for b in ('Arm', 'ForeArm', 'Hand'))}
            for v in named['capelet']:
                w = v[dl]
                for g, n in list(arm.items()):
                    if g in w and w[g] > 0:
                        x = w[g] * 0.75
                        w[g] -= x
                        S = 'Left' if 'Left' in n else 'Right'
                        w[gi['mixamorig:%sShoulder' % S]] = w.get(gi['mixamorig:%sShoulder' % S], 0) + x * 0.6
                        w[gi['mixamorig:Spine2']] = w.get(gi['mixamorig:Spine2'], 0) + x * 0.4
    if d['from'] == 'vtunic_src':
        # RehmanPolanski's viking tunic: the tunic, its belt, the buckle.
        assert len(parts) == 3, [len(p) for p in parts]
        named = {'tunic': parts[0], 'belt': parts[1] + parts[2]}
        for k, vs in named.items():
            if k not in d.get('keep', named):
                kill += vs
    bmesh.ops.delete(bm, geom=list({v for v in kill if v.is_valid}), context='VERTS')
    if d.get('lengthen'):
        lengthen(bm, o, rig, d['lengthen'])
    if d.get('cut') == 'knee':
        knee = (bone_head(rig, 'LeftLeg') + bone_head(rig, 'RightLeg')) / 2
        z = knee.z + 0.05
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector((0, 0, z)), plane_no=Vector((0, 0, 1)), clear_inner=True)
    if d.get('collar'):
        collar(bm, o, basemesh, rig, d['collar'])
    # (Extrusions can come out wound the other way: faces turned consistently outwards.)
    if d.get('lengthen') or d.get('collar'):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return o


def collar(bm, o, basemesh, rig, gap):
    """Raise a wide, low neckline into a plain round collar at the base of
    the neck: the neckline's edge is extruded twice, up and in, its new edge
    laid `gap` over the body just below the neck joint (a turned and hemmed
    edge; the fabric's weave runs on in the bind pose). The new rings keep
    the skin weights of the edge they grew from."""
    import math
    from mathutils.bvhtree import BVHTree
    tree = body_tree(basemesh)
    neck = bone_head(rig, 'Neck')
    sh = (bone_head(rig, 'LeftArm').z + bone_head(rig, 'RightArm').z) / 2
    ow, owi = o.matrix_world, o.matrix_world.inverted()
    ring = {v for v in bm.verts if v.is_boundary and (ow @ v.co).z > sh - 0.08 and abs((ow @ v.co).x - neck.x) < 0.2}
    edges = [e for e in bm.edges if e.is_boundary and e.verts[0] in ring and e.verts[1] in ring]
    if not edges:
        return
    ztop = neck.z - 0.018

    # Each edge vertex's bearing round the neck, smoothed over its neighbours
    # within 4 cm (the square neckline's corners double back on themselves).
    verts = list({v for e in edges for v in e.verts})
    P = {v: ow @ v.co for v in verts}
    tang = {}
    for v in verts:
        sx = sy = 0.0
        for u in verts:
            d = (P[u] - P[v]).length
            if d < 0.04:
                w = 1 - d / 0.04
                a = math.atan2(P[u].y - neck.y, P[u].x - neck.x)
                sx += math.cos(a) * w
                sy += math.sin(a) * w
        tang[v] = math.atan2(sy, sx)
    loop = verts

    def target(a):
        d = Vector((math.cos(a), math.sin(a), 0))
        # The front dips a little lower than the back, as a collar sits.
        z = ztop - 0.012 * max(0.0, -d.y)
        c = Vector((neck.x, neck.y, z))
        hit = tree.ray_cast(c, d, 0.4)
        r = ((hit[0] - c).length if hit[0] is not None else 0.07) + gap
        return c + d * r

    base = {v: ow @ v.co for v in loop}
    cur, src = edges, {v: v for v in verts}
    for f in (0.35, 0.7, 1.0):
        res = bmesh.ops.extrude_edge_only(bm, edges=cur)
        nv = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
        # Which loop vertex each new one grew from (the nearest of the previous ring's).
        new_src = {}
        for v in nv:
            for e in v.link_edges:
                o2 = e.other_vert(v)
                if o2 in src and o2 not in nv:
                    new_src[v] = src[o2]
        for v in nv:
            s0 = new_src.get(v)
            if s0 is None:
                continue
            t = target(tang[s0])
            v.co = owi @ base[s0].lerp(t, f)
        print('NPC2 collar ring', f, len(loop), len(edges), len(nv), len(new_src), flush=True)
        src = new_src
        cur = [g for g in res['geom'] if isinstance(g, bmesh.types.BMEdge) and g.is_boundary]
    bm.normal_update()


def lengthen(bm, o, rig, by, step=0.045, flare=0.22):
    """Let a short tunic down to the knee: its hem extruded downwards, ring
    by ring, each flared out from the hips' axis (`flare` per metre) as a
    skirt hangs. New rings keep the hem's skin weights and UVs."""
    ow, owi = o.matrix_world, o.matrix_world.inverted()
    hips = rig.matrix_world @ rig.data.bones['mixamorig:Hips'].head_local
    low = min((ow @ v.co).z for v in bm.verts)
    hem = [e for e in bm.edges if e.is_boundary and all((ow @ v.co).z < low + 0.06 for v in e.verts)]
    n = max(1, round(by / step))
    cur = hem
    for k in range(n):
        res = bmesh.ops.extrude_edge_only(bm, edges=cur)
        nv = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
        for v in nv:
            p = ow @ v.co
            r = Vector((p.x - hips.x, p.y - hips.y, 0))
            p = p + Vector((0, 0, -by / n)) + r.normalized() * (flare * by / n)
            v.co = owi @ p
        cur = [g for g in res['geom'] if isinstance(g, bmesh.types.BMEdge) and g.is_boundary]
    bm.normal_update()


def relax(o, basemesh, iters, gap=0.006):
    """Smooth away an asset's crumpled, sculpted folds (a veil's), then push
    it back out of the body (it shrinks as it smooths) to `gap` over it."""
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for _ in range(iters):
        bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if not v.is_boundary], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    tree = body_tree(basemesh)
    ow, owi = o.matrix_world, o.matrix_world.inverted()
    moved = 0
    for v in bm.verts:
        p = ow @ v.co
        loc, nrm, _, d = tree.find_nearest(p, 0.1)
        if loc is None:
            continue
        side = (p - loc).dot(nrm)
        if side < gap:
            v.co = owi @ (loc + nrm * gap)
            moved += 1
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return moved


def lift_hood(o, basemesh, above=0.045, slump_k=0.7):
    """A hood fitted over a scanned head (fuller than MakeHuman's, with its
    hair) falls over the eyes: its front is raised (and drawn back a little)
    until the opening's top edge clears the brows by `above`."""
    import headfit
    co = headfit.mix_coords(basemesh)
    eye = (headfit.group_centroid(basemesh, co, 'helper-l-eye') + headfit.group_centroid(basemesh, co, 'helper-r-eye')) / 2
    bm = bmesh.new()
    bm.from_mesh(o.data)
    ow, owi = o.matrix_world, o.matrix_world.inverted()
    # The opening's top edge: the lowest of the hood in front of the face's middle, above the eyes' line.
    front = [ow @ v.co for v in bm.verts if abs((ow @ v.co).x - eye.x) < 0.035 and (ow @ v.co).y < eye.y + 0.02 and (ow @ v.co).z > eye.z - 0.03]
    if not front:
        bm.free()
        return 0.0
    top = min(p.z for p in front)
    d = eye.z + above - top
    # (Raising the hood made it a tall hat: the opening is cut instead, below.)
    d = 0.0
    def ss(a, b, x):
        t = min(1.0, max(0.0, (x - a) / (b - a)))
        return t * t * (3 - 2 * t)
    for v in bm.verts:
        p = ow @ v.co
        w = ss(eye.y + 0.14, eye.y - 0.01, p.y) * ss(eye.z - 0.09, eye.z - 0.02, p.z)
        if w > 0:
            v.co = owi @ (p + Vector((0, 0, d * w)))
    # Slumped: a woollen hood lies on the skull rather than standing up as a
    # peak. Over the brow, each vertex's distance from the head is cut to a
    # quarter (plus 1 cm), along the head's normal, so the cloth's layers keep
    # their order; easing in over the forehead.
    from mathutils.bvhtree import BVHTree
    head = body_tree(basemesh)
    # (Radially, from the skull's middle, so neighbouring cloth moves together
    # and no folds are made: the head's surface along each ray is smooth.)
    c = eye + Vector((0, 0.085, 0.03))
    slump = 0
    for v in bm.verts:
        p = ow @ v.co
        k = ss(eye.z + 0.0, eye.z + 0.06, p.z) * ss(eye.y + 0.03, eye.y + 0.08, p.y)
        if k <= 0:
            continue
        u = p - c
        r = u.length
        if r < 1e-6:
            continue
        u /= r
        hit = head.ray_cast(c, u, 0.4)
        if hit[0] is None:
            continue
        rh = (hit[0] - c).length
        want = rh + 0.016 + 0.4 * max(0.0, r - rh - 0.016)
        if want >= r:
            continue
        v.co = owi @ (c + u * (r + (want - r) * k * slump_k))
        slump += 1
    # The face's opening kept clear, without cutting the cloth: hood cloth in
    # front of the face (chin to brow, cheekbone to cheekbone) is drawn back
    # and aside to the face's outline, the cloth round it following smoothly
    # (a displacement field, smoothed over the mesh), so the opening's rim
    # stays the artist's folded hem.
    eL = headfit.group_centroid(basemesh, co, 'helper-l-eye')
    eR = headfit.group_centroid(basemesh, co, 'helper-r-eye')
    half = abs(eL.x - eR.x) / 2 + 0.045
    bm.verts.ensure_lookup_table()
    disp = [Vector() for _ in bm.verts]
    fixed = [False] * len(bm.verts)
    # The opening an ellipse round the face (brow to chin, cheekbone to
    # cheekbone): cloth inside it pushed straight out from its middle to its
    # rim, so the rim is a smooth oval, not sheared sideways at the brow (a
    # notch, with the hood's inside turned out).
    ez, ax, az = eye.z - 0.05, half, 0.088
    for v in bm.verts:
        p = ow @ v.co
        dx, dz = p.x - eye.x, p.z - ez
        e = math.sqrt((dx / ax) ** 2 + (dz / az) ** 2)
        if e < 1.0 and p.y < eye.y + 0.02:
            if e < 0.05:
                dx, dz, e = 0.0, 0.05 * az, 0.05
            k = 1.0 / e
            disp[v.index] = Vector((dx * (k - 1), max(0.0, eye.y + 0.02 - p.y), dz * (k - 1)))
            fixed[v.index] = True
    nbr = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    for _ in range(30):
        nd = list(disp)
        for i in range(len(disp)):
            if fixed[i] or not nbr[i]:
                continue
            acc = Vector()
            for j in nbr[i]:
                acc += disp[j]
            nd[i] = acc / len(nbr[i]) * 0.97
        disp = nd
    for v in bm.verts:
        v.co = owi @ ((ow @ v.co) + disp[v.index])
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return float(d)


def head_rigid(o, basemesh):
    """A hood's crown and face opening move with the head: above the jaw its
    skin weights are eased over to the head bone alone (the fitted ones mix
    in the neck and spine, so as the head turns the rim lags and cuts the
    brow). Returns the vertices changed."""
    import headfit
    co = headfit.mix_coords(basemesh)
    eye = (headfit.group_centroid(basemesh, co, 'helper-l-eye') + headfit.group_centroid(basemesh, co, 'helper-r-eye')) / 2
    if 'mixamorig:Head' not in o.vertex_groups:
        o.vertex_groups.new(name='mixamorig:Head')
    hg = o.vertex_groups['mixamorig:Head']
    ow = o.matrix_world
    n = 0
    for v in o.data.vertices:
        z = (ow @ v.co).z
        t = min(1.0, max(0.0, (z - (eye.z - 0.11)) / 0.06))
        k = t * t * (3 - 2 * t)
        if k <= 0:
            continue
        tot = 0.0
        for g in v.groups:
            if g.group != hg.index:
                g.weight *= (1 - k)
            tot += g.weight
        cur = next((g.weight for g in v.groups if g.group == hg.index), 0.0)
        hg.add([v.index], cur + max(0.0, 1.0 - tot), 'REPLACE')
        n += 1
    return n


def body_tree(basemesh):
    """The body's surface as it now is, every shape key mixed (the scanned
    head's fit, the neck's): the depsgraph's evaluated mesh can lag the keys
    just added, leaving cloth fitted round MakeHuman's own smaller head."""
    import headfit
    from mathutils.bvhtree import BVHTree
    co = headfit.mix_coords(basemesh)
    return BVHTree.FromPolygons(co, [tuple(p.vertices) for p in basemesh.data.polygons])
