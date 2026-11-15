import { realpath } from 'node:fs/promises';
import { resolve, dirname, basename, join, relative, isAbsolute, sep } from 'node:path';

const contains = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
};

/** Canonicalize existing parents before reserving a new evidence directory. */
export async function evidenceDirectory(before, after, requested) {
  const path = resolve(requested);
  const output = join(await realpath(dirname(path)), basename(path));
  for (const input of [before, after]) {
    const root = await realpath(input);
    if (contains(root, output) || contains(output, root)) {
      throw Error('Evidence and source roots must be disjoint');
    }
  }
  return output;
}

/** A missing local image/style/document invalidates native rendering evidence. */
export function localResourceFailures(states) {
  return ['before', 'after'].flatMap(mode => states[mode].missing.map(
    ({ status, url }) => `${mode}: HTTP ${status} ${url}`,
  ));
}
