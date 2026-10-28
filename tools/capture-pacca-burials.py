"""Capture the burial access and test the real player against production colliders."""
from pathlib import Path
import argparse
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:5173')
parser.add_argument('--output', type=Path, default=ROOT / 'docs/benevento/pacca-validation')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
        args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 780, 'height': 844}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(args.url.rstrip('/') + '/tools/pacca-burials-audit.html', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function('window.ready', timeout=240000)
    report = {'scope': 'Existing town chunks, production groundCollider and Player; isolated lighting, no NPCs.'}
    for mode in ['before', 'after', 'interior']:
        report[mode] = page.evaluate('(m)=>window.render(m)', mode)
        page.screenshot(path=str(args.output / (mode + '.png')))
    report['walk'] = page.evaluate('window.walk()')
    report['errors'] = errors
    (args.output / 'render-and-traversal.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)
    browser.close()
    assert not errors, 'Browser errors during capture'
    assert all(w['distance'] < .25 and w['frames'] < 1000 for w in report['walk']), 'Blocked route'
    assert all(-1.95 < w['height'] < -1.25 for w in report['walk'][:-1]), 'Incorrect burial floor level'
    assert 1.2 < report['walk'][-1]['height'] < 2.2, 'Did not return to the surface'
