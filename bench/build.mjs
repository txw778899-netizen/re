// Build the @zhenre benchmark page bundle (IIFE, minified — mirrors build-prod).
import { build } from 'esbuild';

await build({
  entryPoints: ['bench/re/src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  outfile: 'bench/re/main.js',
  alias: { '@zhenre/core': './packages/core/src/index.ts' },
  target: 'chrome120',
  logLevel: 'info',
});
