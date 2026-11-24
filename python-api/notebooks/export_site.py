"""Export the backtest notebooks for the site's /research pages.

    python notebooks/export_site.py      (from python-api/, with the dev requirements)

Each notebook becomes app/research/_data/notebook-<slug>.json, a list of cells with the
markdown rendered to HTML, the code highlighted by Pygments (class names, so the
site's theme colours them), and outputs reduced to images, tables and text.
Figures are written to public/research/<slug>/ rather than inlined, so the page
stays small. Run it after re-executing a notebook; the site reads nothing else.
"""

from __future__ import annotations

import base64
import io
import json
import re
from pathlib import Path

import nbformat
from nbconvert.filters.markdown_mistune import markdown2html_mistune
from PIL import Image
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import PythonLexer

ROOT = Path(__file__).resolve().parents[2]
NOTEBOOKS = {
    'evidence': 'Evidence for the dashboard’s claims',
    'backtest': 'Development backtest of the valuation signals',
}
FORMATTER = HtmlFormatter(nowrap=True)
# pandas' scoped <style> block and presentational attributes; the site styles tables itself.
STRIP = [re.compile(r'<style[^>]*>.*?</style>', re.S), re.compile(r'\s(border|style)="[^"]*"')]


def table_html(html: str) -> str:
    for pattern in STRIP:
        html = pattern.sub('', html)
    return html.strip()


def image(data: str, folder: Path, name: str) -> dict:
    raw = base64.b64decode(data)
    (folder / name).write_bytes(raw)
    im = Image.open(io.BytesIO(raw)).convert('RGBA')
    # An opaque corner means the figure was drawn on white (matplotlib's default),
    # so the page mounts it on a paper card instead of the themed surface.
    return {'kind': 'image', 'src': f'/research/{folder.name}/{name}', 'width': im.width,
            'height': im.height, 'opaque': im.getpixel((0, 0))[3] == 255}


def outputs(cell, folder: Path, index: int) -> list[dict]:
    result = []
    for n, out in enumerate(cell.get('outputs', [])):
        data = out.get('data', {})
        if 'image/png' in data:
            result.append(image(data['image/png'], folder, f'{index}-{n}.png'))
        elif 'text/html' in data:
            result.append({'kind': 'html', 'html': table_html(''.join(data['text/html']))})
        elif 'text/plain' in data:
            result.append({'kind': 'text', 'text': ''.join(data['text/plain'])})
        elif out.get('output_type') == 'stream' and out.get('name') == 'stdout':
            result.append({'kind': 'text', 'text': ''.join(out['text'])})
        elif out.get('output_type') == 'error':
            result.append({'kind': 'text', 'text': f"{out['ename']}: {out['evalue']}"})
    return result


def export(slug: str, title: str) -> None:
    nb = nbformat.read(ROOT / 'python-api' / 'notebooks' / f'{slug}.ipynb', as_version=4)
    folder = ROOT / 'public' / 'research' / slug
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob('*.png'):
        old.unlink()
    cells = []
    for index, cell in enumerate(nb.cells):
        if cell.cell_type == 'markdown':
            cells.append({'kind': 'markdown', 'html': markdown2html_mistune(cell.source)})
        elif cell.cell_type == 'code' and cell.source.strip():
            first = next(line for line in cell.source.splitlines() if line.strip()).strip().lstrip('# ')
            cells.append({'kind': 'code', 'html': highlight(cell.source, PythonLexer(), FORMATTER),
                          'summary': first if len(first) <= 110 else first[:107] + '...',
                          'count': cell.get('execution_count'), 'outputs': outputs(cell, folder, index)})
    target = ROOT / 'app' / 'research' / '_data' / f'notebook-{slug}.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({'slug': slug, 'title': title, 'cells': cells}, ensure_ascii=False))
    print(target.relative_to(ROOT), f'{target.stat().st_size / 1024:.0f} KB,', len(list(folder.glob('*.png'))), 'figures')


if __name__ == '__main__':
    for slug, title in NOTEBOOKS.items():
        export(slug, title)
