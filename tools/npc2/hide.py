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


def mark(basemesh, garments, outfits, specs):
    """Write `_hide` on the body and every garment; returns stats."""
    bvh = {g: world_bvh(o) for g, o in garments.items()}
    meshes = {'body': basemesh, **garments}
    rest = {k: rest_positions(o) for k, o in meshes.items()}
    nbs = {k: neighbours(o) for k, o in meshes.items()}
    bits = {k: [0] * len(o.data.vertices) for k, o in meshes.items()}
    stats = {}
    for bit, (oid, of) in enumerate(outfits.items()):
        gs = [g for g in of['garments'] if g in garments]
        for k, o in meshes.items():
            if k != 'body' and k not in gs:
                continue
            # What lies over this mesh: every garment for the body; for a garment, those layered over it.
            depth = specs[k]['depth'] if k != 'body' else -1
            over = [g for g in gs if g != k and specs[g]['depth'] > depth]
            if not over:
                continue
            pos, nrm = rest[k]
            m = covered(pos, nrm, [bvh[g] for g in over], TILT if k == 'body' else math.radians(30))
            m = erode(m, nbs[k], 2 if k == 'body' else 1)
            if k == 'body':
                # The artists' own delete groups (for whole-garment coverage such as hose under boots).
                for g in over:
                    dg = specs[g].get('delete')
                    if dg and dg in o.vertex_groups:
                        gi = o.vertex_groups[dg].index
                        for v in o.data.vertices:
                            if any(x.group == gi and x.weight > 0.5 for x in v.groups):
                                m[v.index] = True
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
