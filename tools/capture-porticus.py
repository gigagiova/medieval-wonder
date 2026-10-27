"""Capture matched old/new Roman site geometry. Run against a fresh Vite server."""
from pathlib import Path
import argparse
import json
import subprocess
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASELINE = '9200a4ac1282c0d5fb23930b40e57c4adc970ff5'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:5173')
parser.add_argument('--output', type=Path, default=ROOT / 'docs/benevento/porticus-validation')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
source = subprocess.check_output(['git', 'show', f'{BASELINE}:src/world.ts'], cwd=ROOT, text=True)
source = source.replace("from './", "from '../../src/")
source += '\nexport function auditBefore(b:Builder) { chapel(b); cellaMemoriae(b); quadragintaRuins(b); }\n'
baseline = ROOT / 'tools/.cache/porticus-before.ts'
baseline.parent.mkdir(parents=True, exist_ok=True)
baseline.write_text(source)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
        args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 780, 'height': 844}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(args.url.rstrip('/') + '/tools/porticus-audit.html', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function('window.ready', timeout=120000)
    report = {'baseline': BASELINE, 'baselineScope': 'Above-ground ruins, chapel and memoria; excludes underground mesh and separately instantiated bone props.'}
    for name, before, inside in [('before', True, False), ('after', False, False), ('interior', False, True)]:
        report[name] = page.evaluate('(v)=>window.render(...v)', [before, inside])
        page.screenshot(path=str(args.output / (name + '.png')))
    report['errors'] = errors
    (args.output / 'render-check.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)
    browser.close()
    if errors:
        raise SystemExit('Browser errors during geometry capture')
