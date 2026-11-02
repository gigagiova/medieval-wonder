"""List meshes (triangles, materials), skins, images and animations of .gltf files (JSON only).
   python3 tools/npca/inspect.py file.gltf ..."""
import json, sys

for f in sys.argv[1:]:
    g = json.load(open(f))
    print('==', f.split('/')[-1])
    acc = g.get('accessors', [])
    mats = g.get('materials', [])
    for n in g.get('nodes', []):
        if 'mesh' in n:
            m = g['meshes'][n['mesh']]
            tris = sum(acc[p['indices']]['count'] // 3 for p in m['primitives'])
            print('  node', n.get('name'), 'mesh', m.get('name'), tris, 'skin' if 'skin' in n else '', [mats[p['material']].get('name') for p in m['primitives'] if 'material' in p], list(m['primitives'][0]['attributes']))
    for s in g.get('skins', []):
        print('  skin', len(s['joints']), ' '.join(g['nodes'][j].get('name', '?') for j in s['joints']))
    for i in g.get('images', []):
        print('  image', i.get('uri', i.get('name')))
    for a in g.get('animations', []):
        print('  anim', a.get('name'))
