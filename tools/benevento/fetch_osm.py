import urllib.request, os, time
os.makedirs('osm', exist_ok=True)
for lon in [14.755, 14.765, 14.775, 14.785, 14.795]:
    for lat in [41.120, 41.128, 41.136]:
        fn = f'osm/t_{lon}_{lat}.xml'
        if os.path.exists(fn) and os.path.getsize(fn) > 1000:
            continue
        url = f'https://api.openstreetmap.org/api/0.6/map?bbox={lon},{lat},{lon+0.01:.3f},{lat+0.008:.3f}'
        req = urllib.request.Request(url, headers={'User-Agent': 'BeneventoResearch/1.0'})
        try:
            data = urllib.request.urlopen(req, timeout=120).read()
            open(fn, 'wb').write(data)
            print(fn, len(data), flush=True)
        except Exception as e:
            print(fn, 'ERR', e, flush=True)
        time.sleep(1)
