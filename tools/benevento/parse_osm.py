import xml.etree.ElementTree as ET, glob, json, math
nodes = {}
ways = {}
rels = {}
for f in glob.glob('osm/*.xml'):
    r = ET.parse(f).getroot()
    for n in r.iter('node'):
        nid = n.get('id')
        tags = {t.get('k'): t.get('v') for t in n.findall('tag')}
        nodes[nid] = (float(n.get('lat')), float(n.get('lon')), tags)
    for w in r.iter('way'):
        tags = {t.get('k'): t.get('v') for t in w.findall('tag')}
        ways[w.get('id')] = ([nd.get('ref') for nd in w.findall('nd')], tags)
    for rl in r.iter('relation'):
        tags = {t.get('k'): t.get('v') for t in rl.findall('tag')}
        rels[rl.get('id')] = ([(m.get('type'), m.get('ref'), m.get('role')) for m in rl.findall('member')], tags)

LAT0, LON0 = 41.1305, 14.7745
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110574.0
def xy(lat, lon):
    return [round((lon - LON0) * KX, 2), round(-(lat - LAT0) * KZ, 2)]

def wpts(refs):
    return [xy(nodes[r][0], nodes[r][1]) for r in refs if r in nodes]

out = {'origin': [LAT0, LON0], 'highways': [], 'water': [], 'waterways': [], 'walls': [], 'buildings': [], 'named': [], 'landuse': [], 'rail': []}
for wid, (refs, tags) in ways.items():
    pts = wpts(refs)
    if len(pts) < 2:
        continue
    name = tags.get('name', '')
    if 'highway' in tags:
        out['highways'].append({'id': wid, 'k': tags['highway'], 'name': name, 'pts': pts, 'area': tags.get('area')})
    if tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank' or tags.get('water'):
        out['water'].append({'id': wid, 'name': name, 'pts': pts})
    if tags.get('waterway') in ('river', 'stream', 'canal', 'ditch'):
        out['waterways'].append({'id': wid, 'k': tags['waterway'], 'name': name, 'pts': pts})
    if tags.get('barrier') == 'city_wall' or tags.get('historic') == 'city_walls' or 'wall' in tags.get('historic', ''):
        out['walls'].append({'id': wid, 'name': name, 'pts': pts, 'tags': tags})
    if 'building' in tags:
        out['buildings'].append({'id': wid, 'pts': pts, 'name': name, 'b': tags['building'], 'h': tags.get('historic', ''), 'amenity': tags.get('amenity', '')})
    if 'landuse' in tags or 'leisure' in tags or tags.get('natural') in ('wood', 'scrub', 'grassland'):
        out['landuse'].append({'id': wid, 'k': tags.get('landuse') or tags.get('leisure') or tags.get('natural'), 'pts': pts, 'name': name})
    if 'railway' in tags:
        out['rail'].append({'id': wid, 'pts': pts})
    if name and ('historic' in tags or 'tourism' in tags or 'amenity' in tags and tags['amenity'] == 'place_of_worship' or 'building' in tags and tags['building'] in ('church', 'cathedral', 'chapel')):
        cx = sum(p[0] for p in pts) / len(pts); cz = sum(p[1] for p in pts) / len(pts)
        out['named'].append({'name': name, 'x': round(cx, 1), 'z': round(cz, 1), 'tags': tags, 'way': wid})
for nid, (lat, lon, tags) in nodes.items():
    if tags.get('name') and ('historic' in tags or 'tourism' in tags or tags.get('amenity') == 'place_of_worship' or 'gate' in tags.get('barrier', '')):
        p = xy(lat, lon)
        out['named'].append({'name': tags['name'], 'x': p[0], 'z': p[1], 'tags': tags})
# relations: multipolygon rivers
for rid, (mem, tags) in rels.items():
    if tags.get('waterway') == 'riverbank' or tags.get('natural') == 'water' or tags.get('type') == 'waterway':
        for t, ref, role in mem:
            if t == 'way' and ref in ways:
                pts = wpts(ways[ref][0])
                if len(pts) > 1:
                    out['water' if tags.get('type') != 'waterway' else 'waterways'].append({'id': ref, 'name': tags.get('name', ''), 'pts': pts, 'rel': rid, 'role': role, 'k': 'rel'})
json.dump(out, open('osm.json', 'w'))
for k, v in out.items():
    if isinstance(v, list):
        print(k, len(v))
seen = set()
for n in sorted(out['named'], key=lambda n: n['x']):
    if n['name'] in seen: continue
    seen.add(n['name'])
    print(f"{n['x']:8.1f} {n['z']:8.1f}  {n['name']}  {dict((k, v) for k, v in n['tags'].items() if k in ('historic', 'tourism', 'amenity', 'building', 'religion'))}")
