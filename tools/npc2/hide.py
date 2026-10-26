"""
Hidden surfaces, per outfit (build.py).

For outfit k (bit k of a `_hide` float vertex attribute on every mesh), a
vertex of the body or of a garment is hidden when the outfit's garments
over it cover it:
  - the garment's MakeHuman delete group says so (body only), or
  - every ray from it, out along its normal and tilted round it, meets an
    outer garment of the outfit within reach, or it already pokes out
    through one (a short ray inwards meets that garment from behind);
then the hidden set is eroded by a ring or two, so the cloth's edges always
overlap some skin or underlayer however the limbs move. The game drops the
triangles all of whose corners are hidden.
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

REACH = 0.22   # m: how far out a covering garment may hang
POKE = 0.03    # m: how far a vertex may stick out through a garment and still count as under it
TILT = math.radians(50)


def world_bvh(o):
    dg = bpy.context.evaluated_depsgraph_get()
    oe = o.evaluated_get(dg)
    me = oe.to_mesh()
    mw = o.matrix_world
    verts = [mw @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    oe.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)


def rest_positions(o):
    """Bind-pose world positions and normals (shape keys applied, no armature pose)."""
    mw = o.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    return [mw @ v.co for v in o.data.vertices], [(nm @ v.normal).normalized() for v in o.data.vertices]


def dirs_round(n, tilt=TILT):
    t = n.orthogonal().normalized()
    b = n.cross(t)
    out = [n]
    for i in range(6):
        a = i * math.pi / 3
        d = (t * math.cos(a) + b * math.sin(a))
        out.append((n * math.cos(tilt) + d * math.sin(tilt)).normalized())
    return out


def clearance(o, bvhs, gap=0.015, near=0.035):
    """Push an under-layer in, along its normals, wherever an outer layer
    lies closer over it than `gap` (or it sticks out through one): the layers
    then keep apart when skinning bends them a little differently. The
    displacement is smoothed over two rings so the surface stays fair."""
    me = o.data
    mwi = o.matrix_world.inverted()
    pos, nrm = rest_positions(o)
    push = [0.0] * len(pos)
    for i, (p, n) in enumerate(zip(pos, nrm)):
        best = None
        for t in bvhs:
            h = t.ray_cast(p - n * near, n, near * 2)
            if h[0] is not None and h[1].dot(n) > 0.2:
                d = (h[0] - p).dot(n)
                best = d if best is None else min(best, d)
        if best is not None and best < gap:
            push[i] = gap - best
    nb = neighbours(o)
    for _ in range(2):
        push = [max(push[i], 0.6 * max((push[j] for j in nb[i]), default=0)) for i in range(len(push))]
    n_moved = 0
    for i, v in enumerate(me.vertices):
        if push[i] > 0:
            v.co = mwi @ (pos[i] - nrm[i] * push[i])
            n_moved += 1
    me.update()
    return n_moved


def covered(pos, nrm, bvhs, tilt=TILT):
    """Per vertex: covered by the union of bvhs."""
    res = []
    for p, n in zip(pos, nrm):
        # Poking out through a garment: just inside it, facing the same way.
        poke = False
        for t in bvhs:
            hit = t.ray_cast(p + n * 0.001, -n, POKE)
            if hit[0] is not None and hit[1].dot(n) > 0.0:
                poke = True
                break
        if poke:
            res.append(True)
            continue
        ok = True
        for d in dirs_round(n, tilt):
            o = p + n * 0.002
            if not any(t.ray_cast(o, d, REACH)[0] is not None for t in bvhs):
                ok = False
                break
        res.append(ok)
    return res


def neighbours(o):
    nb = [set() for _ in o.data.vertices]
    for e in o.data.edges:
        a, b = e.vertices
        nb[a].add(b)
        nb[b].add(a)
    return nb


def erode(mask, nb, rings):
    for _ in range(rings):
        mask = [m and all(mask[j] for j in nb[i]) for i, m in enumerate(mask)]
    return mask


def mark(basemesh, garments, outfits, specs, knee=None):
    """Write `_hide` on the body and every garment; returns stats."""
    bvh = {g: world_bvh(o) for g, o in garments.items()}
    meshes = {'body': basemesh, **garments}
    rest = {k: rest_positions(o) for k, o in meshes.items()}
    nbs = {k: neighbours(o) for k, o in meshes.items()}
    bits = {k: [0] * len(o.data.vertices) for k, o in meshes.items()}
    stats = {}
    import headfit as _hf0
    _co = _hf0.mix_coords(basemesh)
    waist = (_hf0.group_centroid(basemesh, _co, 'joint-neck').z + (knee if knee is not None else 0.5)) / 2
    for bit, (oid, of) in enumerate(outfits.items()):
        gs = [g for g in of['garments'] if g in garments]
        for k, o in meshes.items():
            if k != 'body' and k not in gs:
                continue
            # What lies over this mesh: every garment for the body; for a garment, those layered over it.
            depth = specs[k]['depth'] if k != 'body' else -1
            # (Not under a cloak or shawl: open and swinging, it uncovers what it hangs over.)
            over = [g for g in gs if g != k and specs[g]['depth'] > depth and not specs[g].get('open')]
            cloaks = [g for g in gs if g != k and specs[g]['depth'] > depth and specs[g].get('open')]
            if not over and not (k != 'body' and cloaks):
                continue
            pos, nrm = rest[k]
            # The body: covered all round (rays out along its normal and tilted 25°
            # about it). A garment under another: wherever the one over it lies
            # straight out from it (a cloak's shoulders over a tunic's).
            m = covered(pos, nrm, [bvh[g] for g in over], math.radians(25) if k == 'body' else 0.0) if over else [False] * len(pos)
            if k != 'body' and cloaks:
                # Under a cloak: the back of the shoulders, upper back and upper
                # arms, which the cloak hangs over in every pose (the sleeves
                # and shoulders came through it as the arms swung). Only faces
                # not turned to the front (the face looks -y in Blender's
                # frame) and above the waist, where the cloak lies straight out.
                back = [i for i in range(len(pos)) if not m[i] and nrm[i].y > -0.2 and pos[i].z > waist]
                cov = covered([pos[i] for i in back], [nrm[i] for i in back], [bvh[g] for g in cloaks], 0.0)
                for i, c in zip(back, cov):
                    if c:
                        m[i] = True
            m = erode(m, nbs[k], 1)
            if k == 'body':
                # The artists' own delete groups (for whole-garment coverage such as hose under boots).
                for g in over:
                    dg = specs[g].get('delete')
                    if dg and dg in o.vertex_groups:
                        gi = o.vertex_groups[dg].index
                        for v in o.data.vertices:
                            if any(x.group == gi and x.weight > 0.5 for x in v.groups):
                                m[v.index] = True
            if k == 'body':
                # Kept within 4 cm of any edge of the cloth over it — collars,
                # cuffs, hems and the slits of the artists' seams — so a
                # gap opening there as the cloth moves shows skin, never a
                # hole (no floating hands at the cuffs, no void at a seam).
                # (Only where nothing else lies over it: a hood's hem on a robe's
                # chest keeps the chest under the robe hidden.)
                # Only at the openings people look at: the neck, the wrists and
                # (a hood's) the face; elsewhere a slit's skin would show
                # through its closed edges.
                from mathutils.kdtree import KDTree
                import bmesh as _bm
                import headfit as _hf
                co = _hf.mix_coords(o)
                spots = [(_hf.group_centroid(o, co, 'joint-neck'), 0.16), (_hf.group_centroid(o, co, 'joint-l-hand'), 0.12),
                         (_hf.group_centroid(o, co, 'joint-r-hand'), 0.12)]
                eye = (_hf.group_centroid(o, co, 'helper-l-eye') + _hf.group_centroid(o, co, 'helper-r-eye')) / 2
                def near(p, g):
                    if specs[g].get('layer') == 'head' or g in ('hood', 'cowl'):
                        return (p - eye).length < 0.16
                    return any((p - c).length < r for c, r in spots)
                for g in over:
                    go = garments[g]
                    gm = go.matrix_world
                    t = _bm.new()
                    t.from_mesh(go.data)
                    edge = [gm @ v.co for v in t.verts if v.is_boundary]
                    t.free()
                    if not edge:
                        continue
                    kd = KDTree(len(edge))
                    for j, q in enumerate(edge):
                        kd.insert(q, j)
                    kd.balance()
                    reach = 0.06 if specs[g].get('layer') == 'head' or g in ('hood', 'cowl') else 0.04
                    cand = [i for i in range(len(m)) if m[i] and near(pos[i], g) and kd.find(pos[i])[2] < reach]
                    others = [bvh[x] for x in over if x != g]
                    still = covered([pos[i] for i in cand], [nrm[i] for i in cand], others, math.radians(25)) if others else [False] * len(cand)
                    for i, c in zip(cand, still):
                        if not c:
                            m[i] = False
            if k == 'body' and knee is not None and any(specs[g].get('long') for g in over):
                # Below the knee a long skirt doesn't follow the legs (skirt.py): a
                # striding shin and foot come out from under it, so they are kept,
                # unless something else covers them (hose, boots).
                rest_over = [g for g in over if not specs[g].get('long')]
                m2 = covered(pos, nrm, [bvh[g] for g in rest_over], math.radians(25)) if rest_over else [False] * len(pos)
                for g in rest_over:
                    dg = specs[g].get('delete')
                    if dg and dg in o.vertex_groups:
                        gi = o.vertex_groups[dg].index
                        for v in o.data.vertices:
                            if any(x.group == gi and x.weight > 0.5 for x in v.groups):
                                m2[v.index] = True
                for i in range(len(m)):
                    if pos[i].z < knee:
                        m[i] = m2[i]
            if k != 'body' and knee is not None and any(specs[g].get('long') for g in over):
                # (A shoe under a robe's hem shows as the foot strides out.)
                rest_over = [g for g in over if not specs[g].get('long')]
                m2 = covered(pos, nrm, [bvh[g] for g in rest_over], 0.0) if rest_over else [False] * len(pos)
                for i in range(len(m)):
                    if pos[i].z < knee:
                        m[i] = m[i] and m2[i]
            n = 0
            for i, h in enumerate(m):
                if h:
                    bits[k][i] |= 1 << bit
                    n += 1
            stats[(oid, k)] = (n, len(m))
    for k, o in meshes.items():
        a = o.data.attributes.get('_hide') or o.data.attributes.new('_hide', 'FLOAT', 'POINT')
        a.data.foreach_set('value', [float(b) for b in bits[k]])
    return stats


def poke_report(basemesh, garments, outfits, specs):
    """Visible body vertices (not hidden) lying outside one of the outfit's garments: bind-pose poke-through."""
    out = {}
    a = basemesh.data.attributes['_hide']
    hid = [0.0] * len(basemesh.data.vertices)
    a.data.foreach_get('value', hid)
    pos, nrm = rest_positions(basemesh)
    bvh = {g: world_bvh(o) for g, o in garments.items()}
    for bit, (oid, of) in enumerate(outfits.items()):
        ts = [bvh[g] for g in of['garments'] if g in bvh]
        n = 0
        for i, (p, nr) in enumerate(zip(pos, nrm)):
            if int(hid[i]) >> bit & 1:
                continue
            for t in ts:
                hit = t.ray_cast(p + nr * 0.001, -nr, POKE)
                if hit[0] is not None and hit[1].dot(nr) > 0:
                    n += 1
                    break
        out[oid] = n
    return out
