"""
Townsfolk v2: bake one rigged MakeHuman body and every garment it can wear.

Run inside Blender 4.2 with the MPFB 2 extension and the asset packs listed in
tools/npc2/README (see tools/npc2/build.sh, which runs this for every body):

  blender -b --python tools/npc2/build.py -- BODY_ID OUT.glb

What it does:
  1. MPFB builds the body from its phenotype (gender, age, weight...), with
     the Mixamo-named rig and its weights, eyes and a skin.
  2. Optionally the head is fitted to a scanned head and its skin re-baked
     (see headfit.py) before anything is fitted to it.
  3. Every garment of the body's sex is loaded from its MakeHuman .mhclo:
     fitted to this body's shape and skinned from the body's own weights by
     MPFB (the artist's offsets and reference vertices; no raycasting).
     Some are derived (a knee-length tunic cut from the robe...) or modelled
     here (cloaks, shawls: cloth-simulated on the body, see drape.py).
  4. Per outfit, the body's vertices that its garments hide (the garments'
     own MakeHuman delete groups, plus whatever the garments cover in a
     raycast test) get a bit in a `_hide` vertex attribute; the game drops
     those triangles for that outfit.
  5. Helpers are removed, everything is decimated to the budget, shape keys
     applied, and the whole is exported as one skinned glTF.
"""
import bpy, bmesh, sys, os, json, math, importlib, mathutils
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from specs import BODIES, GARMENTS, OUTFITS  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
BODY, OUT = argv[0], argv[1]
OPTS = set(argv[2:])
spec = BODIES[BODY]
sex = spec['sex']

base = 'bl_ext.user_default.mpfb'
HS = importlib.import_module(base + '.services.humanservice').HumanService
bpy.ops.wm.read_factory_settings(use_empty=True)


def log(*a):
    print('NPC2', *a, flush=True)


# ------------------------------------------------------------------ the body
info = HS._create_default_human_info_dict()
info['phenotype'].update(spec['phenotype'])
info['phenotype']['race'] = spec['race']
info['rig'] = 'mixamo'
info['eyes'] = 'low-poly/low-poly.mhclo'
info['skin_mhmat'] = spec['skin']
info['skin_material_type'] = 'GAMEENGINE'
info['name'] = BODY
if spec.get('eyebrows'):
    info['eyebrows'] = spec['eyebrows']
st = HS.get_default_deserialization_settings()
st['subdiv_levels'] = 0
st['load_clothes'] = False
basemesh = HS.deserialize_from_dict(info, st)
rig = basemesh.parent
log('body', basemesh.name, len(basemesh.data.vertices))

if spec.get('scan') and 'nohead' not in OPTS:
    import headfit
    headfit.fit(basemesh, spec)  # adds the "scanfit" shape key
    HS.refit(basemesh)  # the rig's head joints and the eyes to the new head

# ------------------------------------------------------------------ garments
garments = {}
gspec = {}
for gid, g in GARMENTS.items():
    if sex not in g['sex']:
        continue
    if 'mhclo' in g:
        path = os.path.join(os.environ['NPC2_ASSETS'], 'clothes', g['mhclo'])
        o = HS.add_mhclo_asset(path, basemesh, asset_type='Clothes', subdiv_levels=0, material_type='MAKESKIN')
        o.name = 'G_' + gid
        garments[gid] = o
        zd = [l.split()[1] for l in open(path, encoding='utf-8', errors='replace') if l.startswith('z_depth')]
        gspec[gid] = {'depth': int(zd[0]) if zd else 50, 'delete': 'Delete.' + os.path.basename(path)[:-6].replace(' ', '_')}
        log('garment', gid, len(o.data.vertices))

# Derived garments (cut from others) after all the fitted ones exist.
import derive  # noqa: E402
for gid, g in GARMENTS.items():
    if sex in g['sex'] and 'derive' in g:
        garments[gid] = derive.make(gid, g, garments, basemesh, rig)
        src = g['derive']['from']
        # A derived garment covering what its source did keeps its delete group.
        gspec[gid] = {'depth': gspec[src]['depth'], 'delete': gspec[src]['delete'] if not g['derive'].get('cut') and 'gown' not in g['derive'].get('drop', []) and not g['derive'].get('keep') else None}
        log('derived', gid, len(garments[gid].data.vertices))
# Modelled garments, draped as cloth over the fitted ones.
import drape  # noqa: E402
for gid, g in GARMENTS.items():
    if sex in g['sex'] and 'drape' in g:
        garments[gid] = drape.make(gid, g, garments, basemesh, rig)
        gspec[gid] = {'depth': g.get('depth', 80), 'delete': None}
# Sources only used to derive others are not exported.
for gid in list(garments):
    if GARMENTS[gid].get('only_source'):
        bpy.data.objects.remove(garments.pop(gid))

# ------------------------------------------------------------------ cleanup
def apply_shape_keys(o):
    if o.data.shape_keys:
        bpy.context.view_layer.objects.active = o
        o.shape_key_add(name='mix', from_mix=True)
        for kb in list(o.data.shape_keys.key_blocks)[:-1]:
            o.shape_key_remove(kb)
        o.shape_key_remove(o.data.shape_keys.key_blocks[0])


for o in [basemesh] + list(garments.values()):
    apply_shape_keys(o)
for o in bpy.data.objects:
    if o.type == 'MESH':
        for m in list(o.modifiers):
            if m.type in ('MASK', 'SUBSURF'):
                o.modifiers.remove(m)

# Remove the helper geometry (and what is never seen: the inner mouth stays).
bm = bmesh.new()
bm.from_mesh(basemesh.data)
deform = bm.verts.layers.deform.active
gi = basemesh.vertex_groups['body'].index
kill = [v for v in bm.verts if gi not in v[deform]]
bmesh.ops.delete(bm, geom=kill, context='VERTS')
bm.to_mesh(basemesh.data)
bm.free()
log('body after helpers', len(basemesh.data.vertices), len(basemesh.data.polygons))

if 'prebake' in OPTS:
    bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.glb', '.prebake.blend'))
    sys.exit(0)
if spec.get('scan') and 'nohead' not in OPTS:
    headfit.bake(basemesh, spec, os.path.dirname(OUT))
    # The scan's eyes are in its skin now.
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.name.endswith('low-poly'):
            bpy.data.objects.remove(o)

# ------------------------------------------------------------------ hidden surfaces
import hide  # noqa: E402
myoutfits = {k: v for k, v in OUTFITS.items() if v['sex'] == sex}
# Under-layers kept clear of what is worn over them: the body under the
# garments that cover it in every outfit (not the head: a hood is not
# always worn), each garment under the layers over it.
from hide import clearance, world_bvh  # noqa: E402
body_layers = [g for g in garments if GARMENTS[g]['layer'] in ('tunic', 'leg', 'shoe')]
for g in sorted(garments, key=lambda g: -gspec[g]['depth']):
    over = [h for h in garments if gspec[h]['depth'] > gspec[g]['depth'] and GARMENTS[h]['layer'] != 'head'
            and any(g in of['garments'] and h in of['garments'] for of in myoutfits.values())]
    if over:
        log('clearance', g, clearance(garments[g], [world_bvh(garments[h]) for h in over]))
log('clearance body', clearance(basemesh, [world_bvh(garments[g]) for g in body_layers]))
stats = hide.mark(basemesh, garments, myoutfits, gspec)
for k, v in stats.items():
    log('hidden', k, v)
log('pokes', hide.poke_report(basemesh, garments, myoutfits, gspec))

# ------------------------------------------------------------------ rig ends
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
head = eb['mixamorig:Head']
top = max((basemesh.matrix_world @ v.co).z for v in basemesh.data.vertices)
e = eb.new('mixamorig:HeadTop_End'); e.head = Vector((head.head.x, head.head.y, top)); e.tail = e.head + Vector((0, 0, 0.05)); e.parent = head
for S in ('Left', 'Right'):
    t = eb['mixamorig:%sToeBase' % S]
    e = eb.new('mixamorig:%sToe_End' % S); e.head = t.tail.copy(); e.tail = t.tail + (t.tail - t.head).normalized() * 0.03; e.parent = t
bpy.ops.object.mode_set(mode='OBJECT')

# ------------------------------------------------------------------ export
import exportprep  # noqa: E402
exportprep.prepare(basemesh, garments, rig, spec)
meta = {
    'body': BODY, 'sex': sex, 'height': spec['height'],
    'garments': {gid: {**{k: v for k, v in GARMENTS[gid].items() if k in ('fabric', 'layer', 'map')}, 'depth': gspec[gid]['depth']} for gid in garments},
    'outfits': {k: {'garments': v['garments'], 'bit': i} for i, (k, v) in enumerate(myoutfits.items())},
}
bpy.context.scene['npc2'] = json.dumps(meta)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True, export_skins=True, export_animations=False,
    export_morph=False, export_attributes=True, export_extras=True, export_yup=True, export_apply=False,
    export_image_format='AUTO', export_texcoords=True, export_normals=True, export_tangents=False,
    export_materials='EXPORT', export_def_bones=False, export_rest_position_armature=True,
)
log('exported', OUT)
if 'blend' in OPTS:
    bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.glb', '.blend'))
