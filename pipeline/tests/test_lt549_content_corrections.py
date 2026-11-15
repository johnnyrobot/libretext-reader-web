"""Public apply-to-new-stage seam: source preservation and refusal are observable."""
import hashlib
import importlib.util
import json
from pathlib import Path

from bs4 import BeautifulSoup

MODULE = Path(__file__).resolve().parents[2] / 'content-corrections/LT549/apply.py'
spec = importlib.util.spec_from_file_location('lt549_corrections', MODULE)
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fixture(tmp_path):
    before = '<td class="mt-noheading">\\(\\ce{CO2 (g)}\\)</td>'
    after = '<th class="mt-noheading" scope="col">\\(\\ce{CO2 (g)}\\)</th>'
    original = ('<!doctype html><main id="main-content"><p>Unchanged source.</p>'
                '<table><tr><td>&nbsp;</td>' + before + '</tr></table></main>').encode()
    corrected = original.replace(before.encode(), after.encode())
    source = tmp_path / 'source'
    page = source / 'chem_4b/example/index.html'
    page.parent.mkdir(parents=True)
    page.write_bytes(original)
    bundle = {'schema': 'lt549-exact-source-patch-v1', 'pages': [{
        'path': 'chem_4b/example/index.html', 'beforeSha256': sha(original),
        'afterSha256': sha(corrected), 'edits': [{
            'id': 'header', 'kind': 'cell', 'target': {'table': 1, 'row': 1, 'column': 2},
            'before': before, 'after': after, 'offset': original.index(before.encode()),
        }],
    }]}
    return source, page, original, bundle


def test_promotes_existing_label_without_reserializing_source(tmp_path):
    source, page, original, bundle = fixture(tmp_path)
    destination = tmp_path / 'corrected'
    patch.apply_bundle(source, destination, bundle)
    result = (destination / 'chem_4b/example/index.html').read_bytes()
    header = BeautifulSoup(result, 'html.parser').find('th')
    assert header is not None
    assert header['scope'] == 'col'
    assert header.get_text() == r'\(\ce{CO2 (g)}\)'
    assert page.read_bytes() == original
    assert b'<p>Unchanged source.</p>' in result

import copy
import pytest


def test_drift_refuses_without_creating_a_partial_stage(tmp_path):
    source, page, original, bundle = fixture(tmp_path)
    page.write_bytes(original + b' ')
    with pytest.raises(ValueError, match='source drift'):
        patch.apply_bundle(source, tmp_path / 'out', bundle)
    assert not (tmp_path / 'out').exists()
    assert page.read_bytes() == original + b' '


def test_every_page_is_preflighted_before_any_destination_is_published(tmp_path):
    source, page, original, bundle = fixture(tmp_path)
    other = copy.deepcopy(bundle['pages'][0])
    other['path'] = 'chem_4b/other/index.html'
    target = source / other['path']
    target.parent.mkdir(parents=True)
    target.write_bytes(original + b'drift')
    bundle['pages'].append(other)
    with pytest.raises(ValueError, match='source drift'):
        patch.apply_bundle(source, tmp_path / 'out', bundle)
    assert not (tmp_path / 'out').exists()
    assert page.read_bytes() == original


def test_duplicate_structural_targets_are_refused(tmp_path):
    source, _, _, bundle = fixture(tmp_path)
    other = copy.deepcopy(bundle['pages'][0]['edits'][0])
    other['id'] = 'second-claim-on-same-cell'
    bundle['pages'][0]['edits'].append(other)
    with pytest.raises(ValueError, match='Overlapping or ambiguous'):
        patch.apply_bundle(source, tmp_path / 'out', bundle)
    assert not (tmp_path / 'out').exists()


def test_ambiguous_literal_is_refused_even_with_matching_file_hash(tmp_path):
    source, page, _, bundle = fixture(tmp_path)
    before, after = r'\(\ce{M(OH)_n\)', r'\(\ce{M(OH)_n}\)'
    raw = ('<main><p>' + before + ' and ' + before + '</p></main>').encode()
    page.write_bytes(raw)
    item = bundle['pages'][0]
    item['beforeSha256'] = sha(raw)
    item['edits'] = [{'id': 'brace', 'kind': 'literal', 'target': {},
                      'before': before, 'after': after, 'offset': raw.index(before.encode())}]
    with pytest.raises(ValueError, match='ambiguous'):
        patch.apply_bundle(source, tmp_path / 'out', bundle)
    assert not (tmp_path / 'out').exists()


def test_repeat_is_a_clear_refusal_and_preserves_both_versions(tmp_path):
    source, page, original, bundle = fixture(tmp_path)
    output = tmp_path / 'out'
    patch.apply_bundle(source, output, bundle)
    corrected = (output / 'chem_4b/example/index.html').read_bytes()
    with pytest.raises(ValueError, match='existing destination'):
        patch.apply_bundle(source, output, bundle)
    with pytest.raises(ValueError, match='already applied'):
        patch.apply_bundle(output, tmp_path / 'again', bundle)
    assert page.read_bytes() == original
    assert (output / 'chem_4b/example/index.html').read_bytes() == corrected
    assert not (tmp_path / 'again').exists()


@pytest.mark.parametrize('path', ['chem_4b/../outside/index.html', '/chem_4b/a/index.html'])
def test_page_path_cannot_escape_the_source(tmp_path, path):
    source, page, original, bundle = fixture(tmp_path)
    bundle['pages'][0]['path'] = path
    with pytest.raises(ValueError, match='Unsafe'):
        patch.apply_bundle(source, tmp_path / 'out', bundle)
    assert page.read_bytes() == original


def test_links_are_refused_and_transaction_is_cleaned(tmp_path):
    source, _, _, bundle = fixture(tmp_path)
    external = tmp_path / 'external'
    external.write_text('Must remain untouched')
    (source / 'unrelated-link').symlink_to(external)
    with pytest.raises(ValueError, match='Linked source'):
        patch.apply_bundle(source, tmp_path / 'out', bundle)
    assert external.read_text() == 'Must remain untouched'
    assert not (tmp_path / 'out').exists()
    assert not list(tmp_path.glob('.lt549-*'))


def test_output_must_be_disjoint_and_original_page_cannot_be_linked(tmp_path):
    source, page, original, bundle = fixture(tmp_path)
    with pytest.raises(ValueError, match='disjoint'):
        patch.apply_bundle(source, source / 'out', bundle)
    external = tmp_path / 'external.html'
    external.write_bytes(original)
    page.unlink()
    page.symlink_to(external)
    with pytest.raises(ValueError, match='Linked source page'):
        patch.apply_bundle(source, tmp_path / 'out', bundle)
    assert external.read_bytes() == original


def test_scientific_cell_content_cannot_be_changed(tmp_path):
    source, _, _, bundle = fixture(tmp_path)
    bundle['pages'][0]['edits'][0]['after'] = '<th scope="col">Invented replacement</th>'
    with pytest.raises(ValueError, match='Cell content'):
        patch.apply_bundle(source, tmp_path / 'out', bundle)
    assert not (tmp_path / 'out').exists()


def test_brace_repair_keeps_concentration_brackets_and_entity_spelling(tmp_path):
    source, page, _, bundle = fixture(tmp_path)
    before, after = r'\(\ce[A^{&ndash;}]}\)', r'\(\ce{[A^{&ndash;}]}\)'
    raw = ('<main><p>Concentration ' + before + '</p></main>').encode()
    page.write_bytes(raw)
    item = bundle['pages'][0]
    item.update(beforeSha256=sha(raw), afterSha256=sha(raw.replace(before.encode(), after.encode())))
    item['edits'] = [{'id': 'brace', 'kind': 'literal', 'target': {},
                      'before': before, 'after': after, 'offset': raw.index(before.encode())}]
    patch.apply_bundle(source, tmp_path / 'out', bundle)
    result = (tmp_path / 'out' / item['path']).read_bytes()
    assert br'\ce{[A^{&ndash;}]}' in result
    assert page.read_bytes() == raw


def test_apply_is_reproducible_across_new_destinations(tmp_path):
    source, _, _, bundle = fixture(tmp_path)
    patch.apply_bundle(source, tmp_path / 'a', bundle)
    patch.apply_bundle(source, tmp_path / 'b', bundle)
    for path in (tmp_path / 'a').rglob('*'):
        if path.is_file():
            assert path.read_bytes() == (tmp_path / 'b' / path.relative_to(tmp_path / 'a')).read_bytes()


def test_reviewed_bundle_digest_is_mandatory(tmp_path, monkeypatch):
    replacement = tmp_path / 'bundle.json'
    replacement.write_text('{"altered": true}')
    monkeypatch.setattr(patch, 'BUNDLE', replacement)
    with pytest.raises(ValueError, match='digest mismatch'):
        patch.load_bundle()


def reaction_fixture(tmp_path, corrupt_energy=False):
    bundle = patch.load_bundle()
    operation = next(e for p in bundle['pages'] for e in p['edits'] if e['kind'] == 'rowcells')
    edit = copy.deepcopy(operation)
    raw = ('<main><table><tbody><tr>' + edit['before'] + '</tr></tbody></table></main>').encode()
    if corrupt_energy:
        edit['after'] = edit['after'].replace('+178 kJ/mol', '+179 kJ/mol')
    source = tmp_path / 'source'
    page = source / 'chem_4b/reaction/index.html'
    page.parent.mkdir(parents=True)
    page.write_bytes(raw)
    edit.update(target={'table': 1, 'row': 1}, offset=raw.index(edit['before'].encode()))
    expected = raw.replace(edit['before'].encode(), edit['after'].encode())
    return source, {'schema': patch.SCHEMA, 'pages': [{
        'path': 'chem_4b/reaction/index.html', 'beforeSha256': sha(raw),
        'afterSha256': sha(expected), 'edits': [edit],
    }]}


def test_reaction_grouping_keeps_all_fragments_and_exact_energy(tmp_path):
    source, bundle = reaction_fixture(tmp_path)
    patch.apply_bundle(source, tmp_path / 'out', bundle)
    result = (tmp_path / 'out/chem_4b/reaction/index.html').read_text()
    row = BeautifulSoup(result, 'html.parser').find('tr')
    assert len(row.find_all(['td', 'th'], recursive=False)) == 2
    assert row.th['colspan'] == '4'
    assert row.th['scope'] == 'row'
    assert row.td.get_text() == '+178 kJ/mol'
    assert 'HHe' in row.th.get_text() and 'He' in row.th.get_text()


def test_reaction_energy_change_is_refused_even_with_a_matching_output_hash(tmp_path):
    source, bundle = reaction_fixture(tmp_path, corrupt_energy=True)
    with pytest.raises(ValueError, match='energy cell changed'):
        patch.apply_bundle(source, tmp_path / 'out', bundle)
    assert not (tmp_path / 'out').exists()


def test_noncanonical_alias_page_path_is_refused(tmp_path):
    source, _, _, bundle = fixture(tmp_path)
    bundle['pages'][0]['path'] = 'chem_4b//example/index.html'
    with pytest.raises(ValueError, match='Unsafe'):
        patch.apply_bundle(source, tmp_path / 'out', bundle)


@pytest.mark.parametrize('which', ['before', 'after'])
def test_native_evidence_cannot_write_inside_either_source(tmp_path, which):
    import subprocess
    before, after = tmp_path / 'before', tmp_path / 'after'
    before.mkdir()
    after.mkdir()
    verifier = MODULE.with_name('verify_render.mjs')
    output = {'before': before, 'after': after}[which] / 'accidental-evidence'
    result = subprocess.run(['node', str(verifier), '--before', str(before), '--after', str(after),
                             '--base', 'http://127.0.0.1:8797/', '--output', str(output)],
                            capture_output=True, text=True, timeout=30)
    assert result.returncode != 0
    assert not output.exists()


def test_native_evidence_resolves_parent_aliases_before_writing(tmp_path):
    import subprocess
    before, after = tmp_path / 'before', tmp_path / 'after'
    before.mkdir()
    after.mkdir()
    alias = tmp_path / 'alias'
    alias.symlink_to(before, target_is_directory=True)
    output = alias / 'evidence'
    result = subprocess.run(['node', str(MODULE.with_name('verify_render.mjs')),
                             '--before', str(before), '--after', str(after),
                             '--base', 'http://127.0.0.1:8797/', '--output', str(output)],
                            capture_output=True, text=True, timeout=30)
    assert result.returncode != 0
    assert not output.exists()
