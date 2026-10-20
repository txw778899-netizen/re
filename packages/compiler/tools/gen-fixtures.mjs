/**
 * Fixture generator: computes the EXPECTED slot descriptors for the golden
 * fixtures using a REAL browser (the runtime compiler = ground truth).
 * Run: node packages/compiler/tools/gen-fixtures.mjs (requires playwright)
 * Writes packages/compiler/fixtures/expected.json
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../..', import.meta.url));
process.chdir(root);

// bundle a tiny page script exposing __compileDebug over the fixtures
await build({
  stdin: {
    contents: `
      import { __compileDebug } from '@re/core';
      window.__compile = (strings) => __compileDebug(strings);
    `,
    resolveDir: root,
  },
  bundle: true,
  format: 'iife',
  outfile: 'packages/compiler/fixtures/.gen.js',
  alias: { '@re/core': './packages/core/src/index.ts' },
  target: 'chrome120',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright');

const server = spawn(process.execPath, ['bench/server.mjs'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 500));

const tpl = JSON.parse(readFileSync('packages/compiler/fixtures/templates.json', 'utf8'));
const expected = { description: 'GENERATED from a real browser by tools/gen-fixtures.mjs — do not hand-edit.', templates: [] };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080/bench/harness/blank.html', { waitUntil: 'load' });
await page.addScriptTag({ path: 'packages/compiler/fixtures/.gen.js' });

for (const t of tpl.templates) {
  const compiled = await page.evaluate((s) => window.__compile(s), t.strings);
  expected.templates.push({ name: t.name, strings: t.strings, html: compiled.html, slots: compiled.slots });
  console.log(`  ${t.name}: ${compiled.slots.length} slots`);
}

await browser.close();
server.kill();
writeFileSync('packages/compiler/fixtures/expected.json', JSON.stringify(expected, null, 2));
console.log('Wrote packages/compiler/fixtures/expected.json');
