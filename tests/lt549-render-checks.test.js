import { describe, it, expect } from 'vitest';
import { localResourceFailures } from '../content-corrections/LT549/render_checks.mjs';

describe('required native rendering resources', () => {
  it('invalidates a case with a missing stylesheet or image in either version', () => {
    const failures = localResourceFailures({
      before: { missing: [{ status: 404, url: 'http://127.0.0.1/site.css' }] },
      after: { missing: [{ status: 403, url: 'http://127.0.0.1/image.png' }] },
    });
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain('before: HTTP 404');
    expect(failures[1]).toContain('after: HTTP 403');
  });
  it('does not fabricate a resource failure when both versions loaded', () => {
    expect(localResourceFailures({ before: { missing: [] }, after: { missing: [] } })).toEqual([]);
  });
});
