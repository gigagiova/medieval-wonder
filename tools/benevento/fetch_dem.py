import urllib.request, json, math, time, os, sys
LAT0, LON0 = 41.1305, 14.7745
KX = math.cos(math.radians(LAT0)) * 111320.0; KZ = 110574.0
X0, X1, Z0, Z1, ST = -1200, 1200, -900, 800, 25
xs = list(range(X0, X1 + 1, ST)); zs = list(range(Z0, Z1 + 1, ST))
pts = [(x, z) for z in zs for x in xs]
out = json.load(open('dem_partial.json')) if os.path.exists('dem_partial.json') else {}
todo = [p for p in pts if f'{p[0]},{p[1]}' not in out]
print(len(pts), 'todo', len(todo), flush=True)
for i in range(0, len(todo), 100):
    chunk = todo[i:i + 100]
    locs = '|'.join(f'{LAT0 - z / KZ:.6f},{LON0 + x / KX:.6f}' for x, z in chunk)
    url = 'https://api.opentopodata.org/v1/eudem25m?locations=' + locs
    for a in range(5):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'research'}), timeout=60))
            for (x, z), r in zip(chunk, d['results']):
                out[f'{x},{z}'] = r['elevation']
            break
        except Exception as e:
            print('err', e, flush=True); time.sleep(5)
    json.dump(out, open('dem_partial.json', 'w'))
    print(i, flush=True)
    time.sleep(1.1)
json.dump({'x0': X0, 'z0': Z0, 'step': ST, 'nx': len(xs), 'nz': len(zs), 'h': [out.get(f'{x},{z}') for z in zs for x in xs]}, open('dem.json', 'w'))
print('done')
