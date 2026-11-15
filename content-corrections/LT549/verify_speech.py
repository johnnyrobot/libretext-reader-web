"""Generate before/after speech evidence without rewriting or admitting source pages."""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pipeline.math_speech import MathSpeaker
from pipeline.tokenize import SENTENCE_SPLIT_VERSION
from pipeline.tts_manifest import build_manifest
from apply import load_bundle, sha


def verify_manifest(manifest, html):
    expected = sha(f'v{SENTENCE_SPLIT_VERSION}\0'.encode() + html.encode())
    if manifest['generatedFrom'] != expected:
        raise ValueError('Speech generatedFrom does not bind exact source')
    ids, sentences = set(), set()
    for block in manifest['blocks']:
        if block['id'] in ids or not block['anchor']['path']:
            raise ValueError('Duplicate/unanchored speech block')
        ids.add(block['id'])
        for sentence in block['sentences']:
            if sentence['id'] in sentences:
                raise ValueError('Duplicate speech sentence')
            sentences.add(sentence['id'])
            start, length = sentence['offset'], sentence['length']
            if start < 0 or length < 0 or start + length > len(block['text']):
                raise ValueError('Speech sentence span escapes its block')
            if block['kind'] == 'notice' and (start != 0 or length != 0 or sentence['display']):
                raise ValueError('Notice must not claim a visual text span')
            if block['kind'] != 'notice' and sentence['display'] != block['text'][start:start + length]:
                raise ValueError('Sentence display/source span mismatch')
    if manifest['stats']['blocks'] != len(ids) or manifest['stats']['sentences'] != len(sentences):
        raise ValueError('Speech counts disagree')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--after', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Evidence destination already exists')
    bundle = load_bundle()
    rows = []
    # Source roots are read only. Derived speech remains outside both roots.
    for root in (args.before.resolve(), args.after.resolve()):
        output = args.output.resolve()
        if output == root or root in output.parents or output in root.parents:
            raise ValueError('Evidence and source roots must be disjoint')
    with MathSpeaker() as speaker:
        for page in bundle['pages']:
            manifests = []
            for version, root, expected in [('before', args.before, page['beforeSha256']),
                                            ('after', args.after, page['afterSha256'])]:
                raw = (root / page['path']).read_bytes()
                if sha(raw) != expected:
                    raise ValueError('Speech input page digest mismatch: ' + page['path'])
                html = raw.decode('utf-8')
                page_id = str(Path(page['path']).parent)
                heading = re.search(r'<h1>(.*?)</h1>', html, re.S)
                title = re.sub(r'<[^>]+>', '', heading[1]).strip() if heading else page_id
                manifest = build_manifest(html, page_id=page_id, title=title,
                                          speaker=speaker, chem_book=True)
                verify_manifest(manifest, html)
                path = args.output / version / page_id / 'speech.json'
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                manifests.append(manifest)
            before, after = manifests
            old = {b['id']: b for b in before['blocks']}
            new = {b['id']: b for b in after['blocks']}
            changed = [key for key in old.keys() | new.keys() if old.get(key) != new.get(key)]
            old_empty = {(b['kind'], b['text'], s['display']) for b in before['blocks'] for s in b['sentences'] if not s['speech'].strip()}
            new_empty = {(b['kind'], b['text'], s['display']) for b in after['blocks'] for s in b['sentences'] if not s['speech'].strip()}
            if new_empty - old_empty:
                raise ValueError('Correction introduced a new empty speech sentence')
            rows.append({'page': page['path'],
                         'beforeGeneratedFrom': before['generatedFrom'],
                         'afterGeneratedFrom': after['generatedFrom'],
                         'beforeStats': before['stats'], 'afterStats': after['stats'],
                         'beforeMath': before.get('math'), 'afterMath': after.get('math'),
                         'beforeEmptySpeech': [{'block': b['id'], 'sentence': s['id'], 'display': s['display']} for b in before['blocks'] for s in b['sentences'] if not s['speech'].strip()],
                         'afterEmptySpeech': [{'block': b['id'], 'sentence': s['id'], 'display': s['display']} for b in after['blocks'] for s in b['sentences'] if not s['speech'].strip()],
                         'changedBlocks': sorted(changed),
                         'beforeSkips': [{'id': b['id'], **b['skipped']} for b in before['blocks'] if 'skipped' in b],
                         'afterSkips': [{'id': b['id'], **b['skipped']} for b in after['blocks'] if 'skipped' in b]})
            print(page['path'], before.get('math'), '->', after.get('math'), flush=True)
    worksheet = next(r for r in rows if '/10:_Weak_Acid' in r['page'])
    if worksheet['beforeMath']['failed'] != 2 or worksheet['afterMath']['failed'] != 0:
        raise ValueError('Approved brace repairs did not close the two parser fallbacks')
    report = {'schema': 'reader-speech-lineage-evidence-v1', 'pages': rows,
              'scope': 'Derived evidence only; no page rewriting, catalog admission or actual-audio acceptance'}
    (args.output / 'speech-delta.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
