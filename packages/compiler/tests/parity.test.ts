/**
 * Compiler parity tests:
 *  1. JS reference walker output MUST equal the browser-generated golden
 *     fixtures (fixtures/expected.json) slot-for-slot, path-for-path.
 *  2. If a Zig toolchain is available, the Zig binary output must match too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { compileTemplate } from '../src/walker.ts';

const here = dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(
  readFileSync(join(here, '..', 'fixtures', 'expected.json'), 'utf8'),
);

test(`walker parity: ${expected.templates.length} golden fixtures from real browser`, () => {
  for (const t of expected.templates) {
    const out = compileTemplate(t.strings);
    assert.deepEqual(
      out.slots,
      t.slots,
      `fixture "${t.name}" slots mismatch`,
    );
    assert.equal(out.html, t.html, `fixture "${t.name}" joined html mismatch`);
  }
});

test('walker joinHtml matches runtime join (marker positions)', () => {
  const strings = ['<p>', ' and ', '</p>'];
  const out = compileTemplate(strings);
  assert.equal(out.html, '<p>\u00010\u0002 and \u00011\u0002</p>');
});

const zig = (() => {
  try {
    execFileSync('zig', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

test('zig compiler parity', { skip: zig ? false : 'zig toolchain not installed — CI builds and checks it' }, () => {
  const out = execFileSync(
    'zig',
    ['run', join(here, '..', 'zig', 're_template.zig')],
    { input: JSON.stringify({ templates: expected.templates.map((t) => ({ name: t.name, strings: t.strings })) }), stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const got = JSON.parse(out.toString());
  for (const t of expected.templates) {
    const g = got.templates.find((x: { name: string }) => x.name === t.name)!;
    assert.deepEqual(g.slots, t.slots, `zig fixture "${t.name}" mismatch`);
  }
});
