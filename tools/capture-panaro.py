"""Matched Panaro corner capture with old procedural and new registered tower.
Start a fresh Vite server before running this script.
"""
from pathlib import Path
import argparse
import fcntl
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://localhost:5173')
parser.add_argument('--output', type=Path, default=ROOT / 'docs/benevento/towers/rendered')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
lock = open('/tmp/medieval-wonder-world-capture.lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
        args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1200, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url.rstrip('/') + '/tools/panaro-audit.html',
              wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function('window.ready', timeout=180000)
    report = {'scope': 'Northeast curtain, towers and ground; neutral materials and identical cameras. Baseline has old procedural towers; after includes registered Panaro. Excludes town buildings and production postprocessing.', 'views': {}}
    for mode in ['before', 'after']:
        for view in ['top', 'front']:
            key = f'{mode}-{view}'
            report['views'][key] = page.evaluate('(a)=>render(...a)', [mode, view])
            page.screenshot(path=str(args.output / (key + '.png')))
            print(key, report['views'][key], flush=True)
    report['errors'] = errors
    (args.output / 'render-check.json').write_text(json.dumps(report, indent=2) + '\n')
    browser.close()
    if errors:
        raise SystemExit('Browser errors: ' + '; '.join(errors))
