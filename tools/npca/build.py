"""
Pack the Track A townsfolk (?npc=a): Quaternius' CC0 "Modular Character Outfits -
Fantasy" (Standard) parts on the "Universal Base Characters" (Standard) heads, one
skeleton per sex renamed to Mixamo's bone names (so src/npc/rig.ts retargets the
Universal Animation Library clips onto it like any other body), with:

  - every outfit part kept as its own skinned node (P_<part>), chosen per outfit at run time;
  - the head (and neck) cut from the base character's full body;
  - an ankle-length skirt (robe for clergy and monks, gown for women) made here,
    worn under the tunic's hem and skinned to the legs (see `skirt`);
  - two texture atlases: cloth (outfit maps) and skin (body, head, eyes, hair),
    so that a person draws in two calls.

   python3 tools/npca/build.py <download dir> public/models/npca

<download dir> holds the two unpacked zips (see tools/npca/README.md).
"""
import base64, json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from qgltf import Src

SRC, OUT = sys.argv[1], sys.argv[2]
MCOF = os.path.join(SRC, 'mcof/Modular Character Outfits - Fantasy[Standard]')
OUTF = os.path.join(MCOF, 'Exports/glTF (Godot-Unreal)/Outfits')
UBC = os.path.join(SRC, 'ubc/Universal Base Characters[Standard]')
HAIR = os.path.join(UBC, 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)')
BASE = os.path.join(UBC, 'Base Characters/Godot - UE')
os.makedirs(OUT, exist_ok=True)

# Unreal mannequin (Quaternius) -> Mixamo bone names (the inverse of src/npc/rig.ts UAL).
REN = {'pelvis': 'Hips', 'spine_01': 'Spine', 'spine_02': 'Spine1', 'spine_03': 'Spine2', 'neck_01': 'Neck', 'Head': 'Head', 'root': 'Root'}
for S, s in (('Left', 'l'), ('Right', 'r')):
    REN.update({f'clavicle_{s}': S + 'Shoulder', f'upperarm_{s}': S + 'Arm', f'lowerarm_{s}': S + 'ForeArm', f'hand_{s}': S + 'Hand',
                f'thigh_{s}': S + 'UpLeg', f'calf_{s}': S + 'Leg', f'foot_{s}': S + 'Foot', f'ball_{s}': S + 'ToeBase', f'ball_leaf_{s}': S + 'Toe_End'})
    for F, f in (('Thumb', 'thumb'), ('Index', 'index'), ('Middle', 'middle'), ('Ring', 'ring'), ('Pinky', 'pinky')):
        for k in range(1, 4):
            REN[f'{f}_0{k}_{s}'] = f'{S}Hand{F}{k}'
        REN[f'{f}_04_leaf_{s}'] = f'{S}Hand{F}4'

# Cloth parts: (file, node, part id, layer). Layers are dyed separately at run time.
LAYERS = ['tunic', 'under', 'over', 'legs', 'shoes', 'hood', 'belt', 'skin', 'hair', 'eyes']
PARTS = {
    'man': [
        ('Male_Peasant', 'Male_Peasant_Body', 'tunic', 'tunic'),
        ('Male_Peasant', 'Male_Peasant_Arms', 'arms', 'tunic'),
        ('Male_Peasant', 'Male_Peasant_Legs', 'legs', 'legs'),
        ('Male_Peasant', 'Male_Peasant_Feet', 'boots', 'shoes'),
        ('Male_Ranger', 'Male_Ranger_Body', 'jerkin', 'over'),
        ('Male_Ranger', 'Male_Ranger_Arms', 'jarms', 'tunic'),
        ('Male_Ranger', 'Male_Ranger_Body_Belt_1', 'belt1', 'belt'),
        ('Male_Ranger', 'Male_Ranger_Head_Hood', 'hood', 'hood'),
    ],
    'woman': [
        ('Female_Peasant', 'Female_Peasant_Body', 'bodice', 'over'),
        ('Female_Peasant', 'Female_Peasant_Arms', 'arms', 'under'),
        ('Female_Peasant', 'Female_Peasant_Feet', 'boots', 'shoes'),
        ('Female_Peasant', 'Female_Peasant_Legs', 'legs', 'legs'),
        ('Female_Ranger', 'Female_Ranger_Body', 'jerkin', 'tunic'),
        ('Female_Ranger', 'Female_Ranger_Arms', 'jarms', 'tunic'),
        ('Female_Ranger', 'Female_Ranger_Head_Hood', 'hood', 'hood'),
    ],
}
HEAD = {'man': 'Superhero_Male_FullBody', 'woman': 'Superhero_Female_FullBody'}
HEADTEX = {'man': 'T_Superhero_Male_Ligh.png', 'woman': 'T_Superhero_Female_Light_BaseColor.png'}
BODYTEX = {'man': 'T_Regular_Male_Dark_BaseColor.png', 'woman': 'T_Regular_Female_Dark_BaseColor.png'}
HAIRS = {'man': [('Hair_SimpleParted', 'hair'), ('Hair_Beard', 'beard'), ('Hair_Buzzed', 'buzz'), ('Eyebrows_Regular', 'brows')],
         'woman': [('Hair_Long', 'hair'), ('Hair_Buns', 'buns'), ('Eyebrows_Female', 'brows')]}

# Atlases (1024²). Cloth: the peasant's map left, the ranger's right (each 512 wide, 1024 tall would
# squash; each is placed in a 512² quadrant: top row). Skin: body, head, eyes, hair in quadrants.
CLOTH_Q = {'MI_Peasant': (0, 0), 'MI_Ranger': (1, 0)}
SKIN_Q = {'body': (0, 0), 'head': (1, 0), 'eyes': (0, 1), 'MI_Hair_1': (1, 1), 'MI_Hair_2': (1, 1)}


def atlas_uv(uv, q, inset=0.004):
    u = np.clip(uv[:, 0], 0, 1) * (0.5 - 2 * inset) + q[0] * 0.5 + inset
    v = np.clip(uv[:, 1], 0, 1) * (0.5 - 2 * inset) + q[1] * 0.5 + inset
    return np.stack([u, v], 1)


def boundary_loops(F):
    from collections import defaultdict
    cnt = defaultdict(int)
    for a, b, c in F:
        for e in ((a, b), (b, c), (c, a)):
            cnt[(min(e), max(e))] += 1
    nxt = defaultdict(list)
    for (a, b), c in cnt.items():
        if c == 1:
            nxt[a].append(b); nxt[b].append(a)
    seen, loops = set(), []
    for s in list(nxt):
        if s in seen:
            continue
        loop, prev, cur = [s], None, s
        seen.add(s)
        while True:
            nb = [x for x in nxt[cur] if x != prev and x not in seen]
            if not nb:
                break
            prev, cur = cur, nb[0]
            seen.add(cur); loop.append(cur)
        loops.append(loop)
    return loops


def weld_ids(P, tol=1e-4):
    key = np.round(P / tol).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    return inv.reshape(-1)


def build(sex):
    first = PARTS[sex][0][0]
    sk = Src(os.path.join(OUTF, first + '.gltf'))
    skin0 = sk.j['skins'][0]
    jn = sk.joint_names()
    ibm = sk.acc(skin0['inverseBindMatrices']).reshape(-1, 4, 4)
    J = {n: i for i, n in enumerate(jn)}
    bindW = {n: sk.world(sk.node_index(n)) for n in jn}
    pos = {REN.get(n, n): bindW[n][:3, 3] for n in jn}

    parts = []  # dicts: name, P N UV J W F, kind ('cloth'|'skin'), layer

    def remap(m):
        lut = np.array([J[n] for n in m['jn']])
        return lut[m['J']]

    files = {}
    for f, node, pid, layer in PARTS[sex]:
        s = files.setdefault(f, Src(os.path.join(OUTF, f + '.gltf')))
        ni = s.node_index(node)
        prims = s.prims(ni)
        # How far out the sleeves reach (T-pose, arms along x): the arm's skin inside them is never
        # seen, and in the stride and the talk it came through the shoulders as bare patches.
        cl = [m for m in prims if m['material'] in CLOTH_Q]
        cuff = {sgn: max([(m['P'][:, 0] * sgn).max() for m in cl] + [0]) for sgn in (1, -1)}
        for m in prims:
            if m['material'] not in CLOTH_Q and cl:
                X = m['P'][:, 0]
                inside = np.where(X > 0, X < cuff[1] - 0.03, -X < cuff[-1] - 0.03)
                keep = ~inside[m['F']].all(1)
                m['F'] = m['F'][keep]
            if m['material'] in CLOTH_Q:
                parts.append(dict(name=pid, P=m['P'], N=m['N'], UV=atlas_uv(m['UV'], CLOTH_Q[m['material']]), J=remap(m), W=m['W'], F=m['F'], kind='cloth', layer=layer))
            else:  # the hands' (and wrists') skin, from the regular body's map
                parts.append(dict(name=pid + '_skin', P=m['P'], N=m['N'], UV=atlas_uv(m['UV'], SKIN_Q['body']), J=remap(m), W=m['W'], F=m['F'], kind='skin', layer='skin'))

    # The head and neck from the base character (same head and neck bones as the outfit's skeleton).
    hs = Src(os.path.join(BASE, HEAD[sex] + '.gltf'))
    for ni, n in hs.mesh_nodes():
        for m in hs.prims(ni):
            P = m['P']
            if m['material'].startswith('MI_Superhero'):
                # Above the collar line, within the neck's width (no shoulders).
                neckY = pos['Neck'][1] - (0.06 if sex == 'man' else 0.05)
                # (Not the trapezius: round the back of the collar it came through the tunic.)
                nk = pos['Neck']
                ok = (P[:, 1] > neckY) & (np.abs(P[:, 0]) < 0.12) & ((P[:, 1] > nk[1] + 0.03) | (np.hypot(P[:, 0] - nk[0], P[:, 2] - nk[2]) < 0.075))
                # The scalp a little in, under the hair cards (made for the regular head): it showed through them.
                hc = pos['Head'] + np.array([0, 0.09, 0.01])
                up = np.clip((P[:, 1] - (pos['Head'][1] + 0.13)) / 0.04, 0, 1)[:, None]
                P = hc + (P - hc) * (1 - 0.025 * up)
                keep = ok[m['F']].all(1)
                F = m['F'][keep]
                used = np.unique(F)
                lut = -np.ones(len(P), int); lut[used] = np.arange(len(used))
                parts.append(dict(name='head', P=P[used], N=m['N'][used], UV=atlas_uv(m['UV'][used], SKIN_Q['head']), J=remap(m)[used], W=m['W'][used], F=lut[F], kind='skin', layer='skin'))
            elif m['material'] == 'MI_Eyes':
                parts.append(dict(name='eyes', P=P, N=m['N'], UV=atlas_uv(np.mod(m['UV'], 1.0), SKIN_Q['eyes']), J=remap(m), W=m['W'], F=m['F'], kind='skin', layer='eyes'))
    for f, pid in HAIRS[sex]:
        s = Src(os.path.join(HAIR, f + '.gltf'))
        for ni, n in s.mesh_nodes():
            for m in s.prims(ni):
                q = SKIN_Q[m['material']]
                uv = atlas_uv(m['UV'], q)
                # Both hair maps share one quadrant: hair 1 on its left half, hair 2 on its right.
                uv[:, 0] = q[0] * 0.5 + 0.004 + (np.clip(m['UV'][:, 0], 0, 1) * 0.246) + (0.25 if m['material'] == 'MI_Hair_2' else 0)
                parts.append(dict(name=pid, P=m['P'], N=m['N'], UV=uv, J=remap(m), W=m['W'], F=m['F'], kind='skin', layer='hair'))

    # ---- the ankle-length skirt, worn under the tunic (man) or the jerkin/bodice (woman)
    over = next(p for p in parts if p['name'] == ('tunic' if sex == 'man' else 'jerkin'))
    parts.append(skirt(over, pos, J, sex, 'robe'))
    if sex == 'woman':
        bod = next(p for p in parts if p['name'] == 'bodice')
        parts.append(skirt(bod, pos, J, sex, 'gown'))

    # HeadTop_End: a joint above the head (for measure() and the head-turn aim).
    write(sex, sk, jn, ibm, parts, pos)
    return parts


LEAD = 0.55  # how far the hem follows the legs (the rest hangs from the hips)


def skirt(over, pos, J, sex, name, rings=12):
    """A tube from just inside and above the over-garment's hem down to the ankles.

    Ring 0 sits 5 cm above the hem, 1 cm inside it, skinned exactly as the hem is
    (so the hem always covers it); lower rings flare to an ellipse round both legs
    and are skinned more and more to the leg on their side (thigh above the knee,
    calf below), blended across the middle front and back so the cloth stretches
    between the legs instead of tearing."""
    P, F = over['P'], over['F']
    ids = weld_ids(P)
    Fw = ids[F]
    loops = boundary_loops(Fw)
    first = {}
    for i, w in enumerate(ids):
        first.setdefault(w, i)
    # The hem: the lowest loop going right round the body.
    hip = pos['Hips']
    best = None
    for L in loops:
        Q = P[[first[w] for w in L]]
        ang = np.arctan2(Q[:, 0] - hip[0], Q[:, 2] - hip[2])
        if np.ptp(ang) < 5.5 or len(L) < 16:
            continue
        y = Q[:, 1].mean()
        if best is None or y < best[0]:
            best = (y, Q)
    hemY, H = best
    print(sex, name, 'hem y', round(hemY, 3), 'verts', len(H))
    n = 48
    th = np.linspace(-np.pi, np.pi, n, endpoint=False)
    ang = np.arctan2(H[:, 0] - hip[0], H[:, 2] - hip[2])
    rad = np.hypot(H[:, 0] - hip[0], H[:, 2] - hip[2])
    # The hem's radius at each angle (largest within a small sector), its height there.
    r0 = np.zeros(n); y0 = np.zeros(n)
    for k, t in enumerate(th):
        d = np.abs((ang - t + np.pi) % (2 * np.pi) - np.pi)
        sel = d < 0.25
        if not sel.any():
            sel = d <= d.min() + 1e-9
        r0[k] = rad[sel].max(); y0[k] = H[sel, 1].min()
    top = y0 + 0.05
    ankle = 0.035  # to the ground: the feet are under it, only the toes show
    knee = pos['LeftLeg'][1]
    # Ellipse at the ankle round both feet and a stride's swing: half width, front, back.
    aw, af, ab = (0.25, 0.22, 0.2) if sex == 'man' else (0.24, 0.21, 0.2)
    rows = []
    for r in range(rings + 1):
        t = r / rings
        y = top + (ankle - top) * t
        s = t ** 0.8
        st, ct = np.sin(th), np.cos(th)
        # target ellipse radius at angle th
        ea = aw * 0.8 + aw * 0.2 * t
        eb = np.where(ct > 0, af, ab) * (0.8 + 0.2 * t)
        re = 1.0 / np.sqrt((st / ea) ** 2 + (ct / eb) ** 2)
        rr = (r0 - 0.01) * (1 - s) + np.maximum(re, r0 - 0.01) * s
        x = hip[0] + rr * st
        z = hip[2] + rr * ct
        rows.append(np.stack([x, y, z], 1))
    V = np.concatenate(rows)
    # Normals: outward radial.
    Nn = V - np.array([hip[0], 0, hip[2]]); Nn[:, 1] = 0
    Nn /= np.linalg.norm(Nn, axis=1, keepdims=True)
    # Faces (outward winding: the tube viewed from outside, th increasing to the right going round +y).
    Fs = []
    for r in range(rings):
        for k in range(n):
            a, b = r * n + k, r * n + (k + 1) % n
            c, d = a + n, b + n
            Fs += [[a, c, b], [b, c, d]]
    Fs = np.array(Fs)
    # Check winding against normals; flip if inward.
    tri = V[Fs]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    if (fn * Nn[Fs[:, 0]]).sum() < 0:
        Fs = Fs[:, [0, 2, 1]]
    # UVs: a plain patch of the over-garment's cloth, from just above its hem at each angle.
    # (One plain spot for all of it, at the small of the back: sampling round the hem
    # drew its seams, toggles and stitching down the skirt as dark streaks.)
    kb = int(np.argmin(np.abs(np.abs(th) - np.pi)))
    tgt = np.array([hip[0], y0[kb] + 0.12, hip[2] - (r0[kb] - 0.005)])
    i = np.argmin(((P - tgt) ** 2).sum(1))
    UV = np.tile(over['UV'][i], (len(V), 1))
    # Weights.
    nj = max(J.values()) + 1
    Wd = np.zeros((len(V), nj))
    # Hem weights (dense) at ring 0, from the nearest hem-area vertices.
    Wover = np.zeros((len(P), nj))
    for c in range(4):
        np.add.at(Wover, (np.arange(len(P)), over['J'][:, c]), over['W'][:, c])
    hipI, Ls = J['pelvis'], {'l': (J['thigh_l'], J['calf_l']), 'r': (J['thigh_r'], J['calf_r'])}
    legx = abs(pos['LeftUpLeg'][0] - hip[0])
    for r in range(rings + 1):
        t = r / rings
        for k in range(n):
            i = r * n + k
            v = V[i]
            # hem copy
            near = np.argsort(((P - np.array([v[0], y0[k], v[2]])) ** 2).sum(1))[:4]
            wh = Wover[near].mean(0)
            # legs: left/right blend across the middle, thigh/calf across the knee
            x = v[0] - hip[0]
            wl = np.clip(0.5 + x / (2 * legx * 0.9), 0, 1)
            wl = wl * wl * (3 - 2 * wl)
            kb = np.clip((knee + 0.08 - v[1]) / 0.16, 0, 1)
            wleg = np.zeros(nj)
            for side, ws in (('l', wl), ('r', 1 - wl)):
                th_i, ca_i = Ls[side]
                wleg[th_i] += ws * (1 - kb)
                wleg[ca_i] += ws * kb
            # how much the legs lead: from the hem's own skin at the top to all leg at the hem
            g = min(LEAD, t * 1.4)
            w = wh * (1 - g) + wleg * g
            Wd[i] = w
    # top 4
    order = np.argsort(-Wd, axis=1)[:, :4]
    Wt = np.take_along_axis(Wd, order, 1)
    Wt /= Wt.sum(1, keepdims=True)
    return dict(name=name, P=V, N=Nn, UV=UV, J=order, W=Wt, F=Fs, kind='cloth', layer='tunic')


def write(sex, sk, jn, ibm, parts, pos):
    nodes, meshes, accs, views = [], [], [], []
    buf = bytearray()

    def add(arr, ctype, typ, target=None):
        arr = np.ascontiguousarray(arr)
        while len(buf) % 4:
            buf.append(0)
        v = {'buffer': 0, 'byteOffset': len(buf), 'byteLength': arr.nbytes}
        if target:
            v['target'] = target
        buf.extend(arr.tobytes())
        views.append(v)
        a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if typ == 'VEC3' and ctype == 5126:
            a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accs.append(a)
        return len(accs) - 1

    # Skeleton nodes: copy the joint hierarchy (renamed), plus HeadTop_End.
    src_nodes = sk.j['nodes']
    jidx = [sk.node_index(n) for n in jn]
    newi = {}
    for k, si in enumerate(jidx):
        n = src_nodes[si]
        o = {'name': REN.get(n['name'], n['name'])}
        for key in ('translation', 'rotation', 'scale'):
            if key in n:
                o[key] = n[key]
        nodes.append(o); newi[si] = k
    for k, si in enumerate(jidx):
        ch = [newi[c] for c in src_nodes[si].get('children', []) if c in newi]
        if ch:
            nodes[k]['children'] = ch
    head_k = jn.index('Head')
    nodes.append({'name': 'HeadTop_End', 'translation': [0, 0.2, 0]})
    ht = len(nodes) - 1
    nodes[head_k].setdefault('children', []).append(ht)
    # its inverse bind: inverse of Head world * T(0,0.2,0)
    Hw = sk.world(sk.node_index('Head'))
    T = np.eye(4); T[1, 3] = 0.2
    ibm2 = np.concatenate([ibm, np.linalg.inv(Hw @ T).T.reshape(1, 4, 4)])
    joints = list(range(len(jidx))) + [ht]
    ibmA = add(ibm2.reshape(-1, 16).astype(np.float32), 5126, 'MAT4')
    skins = [{'joints': joints, 'inverseBindMatrices': ibmA, 'skeleton': newi[sk.node_index('root')]}]
    # The skeleton's parent: the source armature's transform above 'root'.
    root_k = newi[sk.node_index('root')]
    arm = {'name': 'Armature', 'children': [root_k]}
    nodes.append(arm); arm_k = len(nodes) - 1

    mats = [
        {'name': 'cloth', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 1}},
        {'name': 'skin', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 1}, 'metallicFactor': 0, 'roughnessFactor': 0.75}},
    ]
    tris = {}
    for p in parts:
        Pp = p['P'].astype(np.float32)
        Nn = p['N'] / np.maximum(1e-9, np.linalg.norm(p['N'], axis=1, keepdims=True))
        layer = np.full(len(Pp), LAYERS.index(p['layer']) if p['layer'] in LAYERS else 7, np.float32)
        prim = {'attributes': {
            'POSITION': add(Pp, 5126, 'VEC3', 34962),
            'NORMAL': add(Nn.astype(np.float32), 5126, 'VEC3', 34962),
            'TEXCOORD_0': add(p['UV'].astype(np.float32), 5126, 'VEC2', 34962),
            'JOINTS_0': add(p['J'].astype(np.uint8), 5121, 'VEC4', 34962),
            'WEIGHTS_0': add((p['W'] / p['W'].sum(1, keepdims=True)).astype(np.float32), 5126, 'VEC4', 34962),
            '_LAYER': add(layer, 5126, 'SCALAR', 34962),
        }, 'indices': add(p['F'].reshape(-1).astype(np.uint16), 5123, 'SCALAR', 34963), 'material': 0 if p['kind'] == 'cloth' else 1}
        meshes.append({'name': 'P_' + p['name'], 'primitives': [prim]})
        nodes.append({'name': 'P_' + p['name'], 'mesh': len(meshes) - 1, 'skin': 0})
        arm['children'].append(len(nodes) - 1)
        tris[p['name']] = tris.get(p['name'], 0) + len(p['F'])
    print(sex, 'triangles by part', tris)

    # Textures.
    def quad(img, q, size=512):
        return img, q
    cloth = Image.new('RGB', (1024, 1024), (90, 80, 70))
    tex = {'MI_Peasant': os.path.join(OUTF, 'T_Peasant_BaseColor.png'), 'MI_Ranger': os.path.join(OUTF, 'T_Ranger_BaseColor.png')}
    for k, q in CLOTH_Q.items():
        cloth.paste(Image.open(tex[k]).convert('RGB').resize((504, 504), Image.LANCZOS), (q[0] * 512 + 4, q[1] * 512 + 4))
    skin = Image.new('RGB', (1024, 1024), (180, 140, 120))
    skin.paste(Image.open(os.path.join(OUTF, BODYTEX[sex])).convert('RGB').resize((504, 504), Image.LANCZOS), (4, 4))
    skin.paste(Image.open(os.path.join(UBC, 'Base Characters/Textures', HEADTEX[sex])).convert('RGB').resize((504, 504), Image.LANCZOS), (516, 4))
    skin.paste(Image.open(os.path.join(BASE, 'T_Eye_Brown.png')).convert('RGB').resize((504, 504), Image.LANCZOS), (4, 516))
    skin.paste(Image.open(os.path.join(HAIR, 'T_Hair_1_BaseColor.png')).convert('RGB').resize((252, 504), Image.LANCZOS), (516, 516))
    skin.paste(Image.open(os.path.join(HAIR, 'T_Hair_2_BaseColor.png')).convert('RGB').resize((252, 504), Image.LANCZOS), (516 + 256, 516))
    # The cloth is dyed at run time: keep only the painted light and shade (folds, seams), as grey round 0.8.
    a = np.asarray(cloth).astype(np.float32) / 255
    L = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    for q in CLOTH_Q.values():
        sl = (slice(q[1] * 512, q[1] * 512 + 512), slice(q[0] * 512, q[0] * 512 + 512))
        reg = L[sl]
        L[sl] = np.clip(0.8 + (reg - np.median(reg)) * 1.1, 0.25, 1.0)
    cloth = Image.fromarray((L * 255).astype(np.uint8)).convert('RGB')
    # glTF UV v runs down the image: the quadrant math above treats v like the image's rows, so no flip.
    cloth.save(os.path.join(OUT, f'{sex}_cloth.webp'), quality=88)
    skin.save(os.path.join(OUT, f'{sex}_skin.webp'), quality=90)

    j = {
        'asset': {'version': '2.0', 'generator': 'tools/npca/build.py'},
        'scene': 0, 'scenes': [{'nodes': [arm_k], 'extras': {'npca': {'sex': sex, 'height': 1.72 if sex == 'man' else 1.6}}}],
        'nodes': nodes, 'meshes': meshes, 'skins': skins, 'materials': mats,
        'textures': [{'source': 0, 'sampler': 0}, {'source': 1, 'sampler': 0}],
        'images': [{'uri': f'{sex}_cloth.webp', 'mimeType': 'image/webp'}, {'uri': f'{sex}_skin.webp', 'mimeType': 'image/webp'}],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
        'accessors': accs, 'bufferViews': views,
        'buffers': [{'byteLength': len(buf), 'uri': 'data:application/octet-stream;base64,' + base64.b64encode(bytes(buf)).decode()}],
    }
    json.dump(j, open(os.path.join(OUT, f'{sex}.json'), 'w'), separators=(',', ':'))
    print(sex, 'json', os.path.getsize(os.path.join(OUT, f'{sex}.json')) // 1024, 'KB')


for sex in ('man', 'woman'):
    build(sex)
