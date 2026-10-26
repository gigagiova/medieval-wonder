"""
Cloth bones (build.py): the loose parts of garments — skirts below the
hips, cloaks and shawls below the shoulders — hang from chains of bones that
the game swings as springs (src/npc2/springs.ts), as mobile and web games
do for skirts, capes and hair (VRM SpringBone, Unity/Unreal "dynamic" or
"jiggle" bones): a few dozen bones per person instead of a cloth solver.

A garment's chains (`spec['chains']`):
  around  'hips'  (a ring round the pelvis, for skirts) or 'neck' (an arc
          behind the shoulders, for cloaks and shawls)
  n       chains, evenly over the angles `arc` (degrees; 0 = the body's
          right, counter-clockwise from above; a full ring is 0-360)
  bones   per chain
  top     how far below the parent joint the chains start (m)
  parent  the body bone they hang from

Each chain bone sits on the garment's surface (pushed in a little), from the
top ring down to the hem. Each garment vertex below the top ring is skinned
to the two chains either side of it (by angle) and, along each, to the two
bones either side of it (by height): four influences, all summing to one,
easing in from the vertex's own (body) weights over `blend` metres at the
top. Bones are named `cb_<set>_<chain>_<bone>` (glTF loaders strip dots); the last of each chain
has an end bone (`.end`).
"""
import bpy, math
from mathutils import Vector


def log(*a):
    print('NPC2 cloth bones', *a, flush=True)


def world(rig, n):
    return rig.matrix_world @ rig.data.bones['mixamorig:' + n].head_local


def ang_of(p, c):
    return math.atan2(-(p.y - c.y), -(p.x - c.x)) % (2 * math.pi)  # 0 = the body's right (-X), 90° = front (-Y)


def add(gid, o, rig, spec):
    ch = spec['chains']
    around, n, nb = ch['around'], ch['n'], ch['bones']
    a0, a1 = (math.radians(x) for x in ch.get('arc', (0, 360)))
    full = abs((a1 - a0) - 2 * math.pi) < 1e-3
    mw = o.matrix_world
    P = [mw @ v.co for v in o.data.vertices]
    if around == 'hips':
        hips = world(rig, 'Hips')
        crotch = (world(rig, 'LeftUpLeg').z + world(rig, 'RightUpLeg').z) / 2
        c = Vector((hips.x, hips.y, 0))
        z0 = crotch + ch.get('top', 0.0)
    else:
        neck = world(rig, 'Neck')
        sh = (world(rig, 'LeftArm').z + world(rig, 'RightArm').z) / 2
        c = Vector((neck.x, neck.y, 0))
        z0 = sh + ch.get('top', -0.05)
    zh = min(p.z for p in P)
    if zh > z0 - 0.05:
        log(gid, 'too short for chains')
        return 0
    angs = [a0 + (a1 - a0) * (i / n if full else i / max(1, n - 1)) for i in range(n)]
    zs = [z0 + (zh - z0) * j / nb for j in range(nb + 1)]

    def surface(a, z):
        """The garment's radius at angle a and height z (the furthest vertex out nearby), pulled in 1.5 cm."""
        best = None
        for p in P:
            if abs(p.z - z) > 0.05:
                continue
            d = (ang_of(p, c) - a + math.pi) % (2 * math.pi) - math.pi
            if abs(d) > 0.35:
                continue
            r = math.hypot(p.x - c.x, p.y - c.y)
            if best is None or r > best:
                best = r
        return max(0.03, (best or 0.12) - 0.015)

    # Chains are shared by the garments of a set (one robe's or another's, a cloak's or a shawl's):
    # built from the first garment of the set, the others skinned to them.
    sid = ch['set']
    names = [['cb_%s_%d_%d' % (sid, i, j) for j in range(nb)] for i in range(n)]
    if names[0][0] in rig.data.bones:
        built = True
    else:
        built = False
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    parent = eb['mixamorig:' + ch['parent']]
    for i, a in enumerate(angs if not built else []):
        d = Vector((-math.cos(a), -math.sin(a), 0))
        pts = [Vector((c.x, c.y, z)) + d * surface(a, z) for z in zs]
        prev, row = parent, []
        for j in range(nb):
            b = eb.new(names[i][j])
            b.head, b.tail = pts[j], pts[j + 1]
            b.parent = prev
            b.use_connect = j > 0
            prev = b
        e = eb.new('cb_%s_%d_end' % (sid, i))
        e.head = pts[-1]
        e.tail = pts[-1] + (pts[-1] - pts[-2]).normalized() * 0.03
        e.parent = prev
        e.use_connect = True
    bpy.ops.object.mode_set(mode='OBJECT')
    if built:
        # Heights from the chains as built.
        z0 = (rig.matrix_world @ rig.data.bones[names[0][0]].head_local).z
        zh = (rig.matrix_world @ rig.data.bones[names[0][-1]].tail_local).z

    # Weights.
    blend = ch.get('blend', 0.08)
    for row in names:
        for nm in row:
            if nm not in o.vertex_groups:
                o.vertex_groups.new(name=nm)
    gname = {g.index: g.name for g in o.vertex_groups}
    k = 0
    for v, p in zip(o.data.vertices, P):
        if p.z > z0 + blend:
            continue
        # Down the chain: tents centred on each bone's middle.
        t = max(0.0, min(nb - 1e-6, (z0 - p.z) / (z0 - zh) * nb))
        bw = {}
        for j in range(nb):
            w = max(0.0, 1 - abs(t - (j + 0.5)))
            if j == 0 and t < 0.5:
                w = 1.0
            if j == nb - 1 and t > nb - 0.5:
                w = 1.0
            if w > 0:
                bw[j] = w
        s = sum(bw.values())
        # Round: the two chains either side.
        a = ang_of(p, c)
        if full:
            f = ((a - a0) % (2 * math.pi)) / (2 * math.pi) * n
            i0 = int(f) % n
            i1, fa = (i0 + 1) % n, f - int(f)
        else:
            f = max(0.0, min(n - 1 - 1e-6, ((a - a0) % (2 * math.pi)) / (a1 - a0) * (n - 1))) if a1 > a0 else 0.0
            if (a - a0) % (2 * math.pi) > (a1 - a0):  # outside the arc: the nearer end chain
                f = 0.0 if ((a - a0) % (2 * math.pi)) - (a1 - a0) > math.pi else n - 1 - 1e-6
            i0 = int(f)
            i1, fa = min(n - 1, i0 + 1), f - int(f)
        cw = {}
        for i, wi in ((i0, 1 - fa), (i1, fa)):
            for j, wj in bw.items():
                cw[names[i][j]] = cw.get(names[i][j], 0) + wi * wj / s
        # Easing in from the body's weights at the top.
        e = 1.0 if p.z <= z0 else 1 - (p.z - z0) / blend
        e = e * e * (3 - 2 * e)
        old = {gname[g.group]: g.weight for g in v.groups if g.weight > 0 and not gname[g.group].startswith('cb_')}
        tot = sum(old.values()) or 1
        new = {nm: w * e for nm, w in cw.items()}
        for nm, w in old.items():
            new[nm] = new.get(nm, 0) + w / tot * (1 - e)
        top4 = sorted(new.items(), key=lambda x: -x[1])[:4]
        s4 = sum(w for _, w in top4) or 1
        for g in list(v.groups):
            o.vertex_groups[g.group].add([v.index], 0.0, 'REPLACE')
        for nm, w in top4:
            o.vertex_groups[nm].add([v.index], w / s4, 'REPLACE')
        k += 1
    log(gid, n, 'chains x', nb, 'bones,', k, 'vertices')
    return k
