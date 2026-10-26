"""
Skirts (build.py): how the cloth below the hips follows the legs.

MakeHuman fits a garment's weights from the body under it, so a skirt's
hem carries the calves' and feet's weights: striding, the cloth between the
legs is torn between two feet a stride apart (edges stretched by 0.3-0.6 m
in the walk: the "broken appendages"). Here, below the crotch, all of a
vertex's leg weight (thigh, calf, foot, toes, either side) is gathered and
given back as:
  - its own side's thigh, a share that eases from `top` at the crotch to
    `hem` at the hem (a long robe lags behind the knee; a short tunic swings
    with the thigh), the sides by x, blended across the middle over +-`mid`
    metres so the front and back between the legs are shared;
  - the pelvis, the rest.
So nothing below the hips follows a knee or a foot.
"""
import re


def bone_world(rig, n):
    return rig.matrix_world @ rig.data.bones['mixamorig:' + n].head_local


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


LEG = re.compile(r'mixamorig:(Left|Right)(UpLeg|Leg|Foot|ToeBase|Toe_End)$')


def fix(o, rig, top=0.85, hem=0.5, mid=0.05):
    hips = bone_world(rig, 'Hips')
    crotch = (bone_world(rig, 'LeftUpLeg').z + bone_world(rig, 'RightUpLeg').z) / 2 - 0.04
    mw = o.matrix_world
    low = min((mw @ v.co).z for v in o.data.vertices)
    for n in ('mixamorig:Hips', 'mixamorig:LeftUpLeg', 'mixamorig:RightUpLeg'):
        if n not in o.vertex_groups:
            o.vertex_groups.new(name=n)
    names = {g.index: g.name for g in o.vertex_groups}
    H, UL, UR = (o.vertex_groups[n] for n in ('mixamorig:Hips', 'mixamorig:LeftUpLeg', 'mixamorig:RightUpLeg'))
    k = 0
    for v in o.data.vertices:
        p = mw @ v.co
        # Eases in over 6 cm above the crotch.
        a = 1 - smooth(crotch, crotch + 0.06, p.z)
        if a <= 0:
            continue
        legs = [(names[g.group], g.weight) for g in v.groups if LEG.match(names[g.group])]
        Lw = sum(w for _, w in legs)
        if Lw <= 0:
            continue
        t = smooth(crotch, low, p.z)
        f = top + (hem - top) * t
        sL = smooth(-mid, mid, p.x - hips.x)  # Blender: the body's left is +X
        for n, w in legs:
            o.vertex_groups[n].add([v.index], w * (1 - a), 'REPLACE')
        UL.add([v.index], Lw * a * f * sL, 'ADD')
        UR.add([v.index], Lw * a * f * (1 - sL), 'ADD')
        H.add([v.index], Lw * a * (1 - f), 'ADD')
        k += 1
    return k
