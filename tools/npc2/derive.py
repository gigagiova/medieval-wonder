"""Garments derived from the fitted MakeHuman ones (build.py)."""
import bpy, bmesh
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
    dg = bpy.context.evaluated_depsgraph_get()
    be = basemesh.evaluated_get(dg)
    me = be.to_mesh()
    mw = basemesh.matrix_world
    tree = BVHTree.FromPolygons([mw @ v.co for v in me.vertices], [tuple(p.vertices) for p in me.polygons])
    be.to_mesh_clear()
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
