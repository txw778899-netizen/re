import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'src', 'index.ts');

test('create-re scaffolds the demo template non-interactively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'create-re-'));
  try {
    execFileSync(process.execPath, [cli, 'my-app', '--template', 'demo', '--yes'], {
      cwd: dir,
      stdio: 'pipe',
    });
    const app = join(dir, 'my-app');
    for (const f of ['package.json', 'vite.config.ts', 'tsconfig.json', 'index.html', 'src/main.ts', 'README.md', '.gitignore']) {
      assert.ok(existsSync(join(app, f)), `missing ${f}`);
    }
    const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['@re/core'], '^0.1.0');
    const main = readFileSync(join(app, 'src', 'main.ts'), 'utf8');
    assert.match(main, /@re\/core/);
    assert.match(main, /each\(/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('create-re rejects unknown templates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'create-re-'));
  try {
    assert.throws(
      () =>
        execFileSync(process.execPath, [cli, 'x', '--template', 'nope', '--yes'], {
          cwd: dir,
          stdio: 'pipe',
        }),
      /unknown template/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('create-re --help exits cleanly', () => {
  const out = execFileSync(process.execPath, [cli, '--help'], { stdio: 'pipe' }).toString();
  assert.match(out, /scaffold a new @re app/);
});
