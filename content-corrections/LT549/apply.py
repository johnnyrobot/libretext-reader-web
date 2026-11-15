"""Apply the fixed LT549 bundle without serializing or editing the source tree."""
import argparse
import difflib
import hashlib
import json
import re
import shutil
import tempfile
from pathlib import Path, PurePosixPath

from bs4 import BeautifulSoup

SCHEMA = 'lt549-exact-source-patch-v1'
BUNDLE = Path(__file__).with_name('bundle.json')
BUNDLE_SHA256 = '642347121d813ebd8ba22bd3e69c1fb6a3deee04af9439d47f06dab5d037cbbf'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_bundle():
    data = BUNDLE.read_bytes()
    if sha(data) != BUNDLE_SHA256:
        raise ValueError('Reviewed bundle digest mismatch')
    return json.loads(data)


def _index(nodes, number):
    if type(number) is not int or not 1 <= number <= len(nodes):
        raise ValueError('Structural target is absent or invalid')
    return nodes[number - 1]


def _cell(raw):
    match = re.fullmatch(r'<(td|th)\b[^>]*>(.*)</\1>', raw, re.S)
    if not match:
        raise ValueError('Expected a complete literal table cell')
    return BeautifulSoup(raw, 'html.parser').find(['td', 'th']), match[2]


def _check_semantics(edit):
    before, after, kind = edit['before'], edit['after'], edit['kind']
    if kind == 'cell':
        old, old_inner = _cell(before)
        new, new_inner = _cell(after)
        if old_inner != new_inner or any(new.get(k) != v for k, v in old.attrs.items()):
            raise ValueError('Cell content or original attributes changed')
        if set(new.attrs) - set(old.attrs) - {'scope', 'id', 'headers'}:
            raise ValueError('Unapproved cell attribute')
    elif kind == 'element':
        old = BeautifulSoup(before, 'html.parser').find()
        if old.name not in {'img', 'iframe'}:
            raise ValueError('Unapproved element kind')
        if not after:
            if old.name != 'img' or old.get('src'):
                raise ValueError('Only a source-less image can be removed')
        else:
            new = BeautifulSoup(after, 'html.parser').find()
            allowed = 'alt' if old.name == 'img' else 'title'
            a = {k: v for k, v in old.attrs.items() if k != allowed}
            b = {k: v for k, v in new.attrs.items() if k != allowed}
            if old.name != new.name or a != b:
                raise ValueError('Element changed beyond its approved name')
    elif kind == 'literal':
        changes = [(op, after[j:k]) for op, _, _, j, k in
                   difflib.SequenceMatcher(None, before, after).get_opcodes() if op != 'equal']
        if changes not in [[('insert', '{')], [('insert', '}')]]:
            raise ValueError('Only one missing brace insertion is permitted')
    elif kind == 'rowcells':
        old = re.findall(r'<td\b[^>]*>.*?</td>', before, re.S)
        new = re.findall(r'<(?:td|th)\b[^>]*>.*?</(?:td|th)>', after, re.S)
        if len(old) != 5 or len(new) != 2 or old[4] != new[1]:
            raise ValueError('Reaction energy cell changed')
        header, inner = _cell(new[0])
        fragments = [_cell(c)[1].strip() for c in old[:4]]
        expected = ' '.join(f for f in fragments if f not in {'', '&nbsp;'})
        original, _ = _cell(old[0])
        if (inner != expected or header.name != 'th' or header.get('scope') != 'row'
                or header.get('colspan') != '4'
                or any(header.get(k) != v for k, v in original.attrs.items())):
            raise ValueError('Reaction fragments changed or reordered')
    else:
        raise ValueError('Unapproved patch operation')


def _plan(data, page):
    if sha(data) != page['beforeSha256']:
        state = 'already applied' if sha(data) == page['afterSha256'] else 'source drift'
        raise ValueError(f'{state}: {page["path"]}')
    text = data.decode('utf-8')
    doc = BeautifulSoup(text, 'html.parser')
    offsets = [0] + [m.end() for m in re.finditer('\n', text)]
    spans, ids = [], set()
    for edit in page['edits']:
        if edit['id'] in ids:
            raise ValueError('Duplicate operation identity')
        ids.add(edit['id'])
        _check_semantics(edit)
        target = edit['target']
        if edit['kind'] == 'literal':
            if text.count(edit['before']) != 1:
                raise ValueError('Literal target is absent or ambiguous')
            start = text.index(edit['before'])
        else:
            if edit['kind'] == 'element':
                node = _index(doc.find_all(target['tag']), target['index'])
            else:
                table = _index(doc.find_all('table'), target['table'])
                rows = [r for r in table.find_all('tr') if r.find_parent('table') is table]
                row = _index(rows, target['row'])
                node = _index(row.find_all(['td', 'th'], recursive=False), target.get('column', 1))
            start = offsets[node.sourceline - 1] + node.sourcepos
        start = len(text[:start].encode('utf-8'))
        before, after = edit['before'].encode('utf-8'), edit['after'].encode('utf-8')
        if start != edit['offset'] or data[start:start + len(before)] != before:
            raise ValueError(f'Exact target preimage mismatch: {edit["id"]}')
        spans.append((start, start + len(before), after))
    spans.sort()
    if any(a[1] > b[0] for a, b in zip(spans, spans[1:])):
        raise ValueError('Overlapping or ambiguous patch targets')
    result = data
    for start, end, after in reversed(spans):
        result = result[:start] + after + result[end:]
    if sha(result) != page['afterSha256']:
        raise ValueError('Expected corrected-page digest mismatch')
    corrected = BeautifulSoup(result, 'html.parser')
    for edit in page['edits']:
        for node in BeautifulSoup(edit['after'], 'html.parser').find_all(id=True):
            if len(corrected.find_all(id=node['id'])) != 1:
                raise ValueError('Header identity is not unique')
    return result


def apply_bundle(source, destination, bundle):
    """Validate every page before copying; publish a new tree only on success."""
    source, destination = Path(source), Path(destination)
    if source.is_symlink() or destination.exists() or destination.is_symlink():
        raise ValueError('Source link or existing destination refused')
    source, destination = source.resolve(strict=True), destination.resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError('Source and destination must be disjoint')
    if bundle['schema'] != SCHEMA or not bundle['pages']:
        raise ValueError('Unexpected or empty bundle')
    prepared, records = {}, []
    for page in bundle['pages']:
        name = page['path']
        parts = PurePosixPath(name).parts
        if (not name.startswith('chem_4b/') or not name.endswith('/index.html')
                or '\\' in name or any(p in {'', '.', '..'} for p in name.split('/'))
                or name in prepared):
            raise ValueError('Unsafe or duplicate page path')
        target = source
        for part in parts:
            target = target / part
            if target.is_symlink():
                raise ValueError('Linked source page refused')
        data = target.read_bytes()
        prepared[name] = _plan(data, page)
        records.append({'path': name, 'beforeSha256': sha(data),
                        'afterSha256': sha(prepared[name]), 'operations': len(page['edits'])})
    receipt = {'schema': SCHEMA, 'packetSha256': bundle.get('packetSha256'),
               'rulingSha256': bundle.get('rulingSha256'), 'pages': records,
               'admission': 'HOLD; no catalog admission or historical reanchoring'}

    def reject_links(directory, names):
        if any((Path(directory) / name).is_symlink() for name in names):
            raise ValueError('Linked source entry refused')
        return []

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.lt549-', dir=destination.parent) as temporary:
        stage = Path(temporary) / 'stage'
        shutil.copytree(source, stage, ignore=reject_links)
        # Detect source movement during copying instead of mixing snapshot revisions.
        for page in bundle['pages']:
            if sha((stage / page['path']).read_bytes()) != page['beforeSha256']:
                raise ValueError('Source changed while staging')
        for name, result in prepared.items():
            (stage / name).write_bytes(result)
        (stage / '.lt549-source-corrections.json').write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if destination.exists() or destination.is_symlink():
            raise ValueError('Destination appeared during staging')
        stage.rename(destination)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    receipt = apply_bundle(args.source, args.output, load_bundle())
    print(json.dumps({'pages': len(receipt['pages']), 'output': str(args.output)}))


if __name__ == '__main__':
    main()
