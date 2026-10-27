"""Matched Arch of Trajan geometry/material views; serve with a fresh Vite instance."""
from pathlib import Path
import argparse
import json
import subprocess
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASELINE = '9200a4ac1282c0d5fb23930b40e57c4adc970ff5'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:5390')
parser.add_argument('--output', type=Path, default=ROOT / 'docs/benevento/trajan-validation')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
source = subprocess.check_output(['git', 'show', f'{BASELINE}:src/benevento/monuments.ts'], cwd=ROOT, text=True)
imports = source[:source.index('// The monuments')].replace("from '../", "from '../../src/").replace("from './", "from '../../src/benevento/")
body = source[source.index('export function arcusTraiani'):source.index('// ---------------------------------------------------------------- Arch "del Sacramento"')]
cache = ROOT / 'tools/.cache/arcus-before.ts'
cache.parent.mkdir(parents=True, exist_ok=True)
cache.write_text(imports + '\nconst seed=(_:number)=>{};\n' + body.replace('export function arcusTraiani', 'export function arcusBefore'))
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
        args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 780, 'height': 844}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: (errors.append(str(e)), print(e.stack, flush=True)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(args.url.rstrip('/') + '/tools/arcus-audit.html', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function('window.ready', timeout=120000)
    report = {'baseline': BASELINE, 'scope': 'Isolated arch with production materials, common neutral lighting and floor; excludes adjoining curtain walls and town.'}
    for view in ['front', 'quarter', 'vault']:
        for before in [True, False]:
            name = ('before-' if before else 'after-') + view
            report[name] = page.evaluate('(v)=>window.render(...v)', [before, view])
            page.screenshot(path=str(args.output / (name + '.png')))
            print(name, report[name], flush=True)
    report['errors'] = errors
    report['valid'] = not errors
    (args.output / 'render-check.json').write_text(json.dumps(report, indent=2) + '\n')
    browser.close()
    if errors:
        raise SystemExit('Browser errors during arch capture')
