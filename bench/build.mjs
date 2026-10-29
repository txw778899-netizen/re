// Build the @zhenre benchmark page bundle (IIFE, minified — mirrors build-prod).
// Optional argv[2]: alternate @zhenre/core entry (e.g. a published dist for
// paired core-version benchmarking).
// Optional argv[3]: alternate app entry (e.g. bench/re/src/main-030cur.ts for
// paired bench-protocol benchmarking).
import { build } from 'esbuild';

const core = process.argv[2] || './packages/core/src/index.ts';
const entry = process.argv[3] || 'bench/re/src/main.ts';

await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: 'iife',
  outfile: 'bench/re/main.js',
  alias: { '@zhenre/core': core },
  target: 'chrome120',
  logLevel: 'info',
});
