/**
 * create-re — scaffold a new @re app. Zero dependencies.
 *
 *   npm create re@latest my-app
 *   create-re my-app --template demo --pm pnpm
 *
 * Templates: minimal (counter + Web Component) | demo (list CRUD) | bench (keyed table).
 */

import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as readline from 'node:readline';
import { TEMPLATES } from './templates.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    template: { type: 'string', short: 't' },
    pm: { type: 'string' },
    yes: { type: 'boolean', short: 'y' },
    help: { type: 'boolean', short: 'h' },
  },
});

function printHelp(): void {
  console.log(`create-re — scaffold a new @re app

Usage:
  npm create re@latest [name] [options]

Options:
  -t, --template <minimal|demo|bench>   project template (default: demo)
      --pm <npm|pnpm|yarn>              package manager (default: npm)
  -y, --yes                             accept defaults, no prompts
  -h, --help                            show this help
`);
}

async function ask(rl: readline.Interface, question: string, fallback: string): Promise<string> {
  const answer = await new Promise<string>((res) => {
    rl.question(question, res);
  });
  return answer.trim() === '' ? fallback : answer.trim();
}

async function main(): Promise<void> {
  if (values.help === true) {
    printHelp();
    return;
  }

  console.log('\n  ⚡ create-re — scaffold a new @re app\n');

  let name = positionals[0] ?? '';
  let template = values.template ?? '';
  let pm = values.pm ?? '';

  const interactive = values.yes !== true;
  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;
  try {
    if (name === '') {
      name = rl
        ? await ask(rl, '  Project name (my-re-app): ', 'my-re-app')
        : 'my-re-app';
    }
    if (template === '') {
      template = rl
        ? await ask(rl, '  Template — minimal | demo | bench (demo): ', 'demo')
        : 'demo';
    }
    if (pm === '') {
      pm = rl ? await ask(rl, '  Package manager — npm | pnpm | yarn (npm): ', 'npm') : 'npm';
    }
  } finally {
    rl?.close();
  }

  if (!Object.hasOwn(TEMPLATES, template)) {
    console.error(`\n  ✖ unknown template "${template}" — choose: ${Object.keys(TEMPLATES).join(' | ')}\n`);
    process.exit(1);
  }

  const target = resolve(process.cwd(), name);
  if (existsSync(target) && !values.yes) {
    console.error(`\n  ✖ "${name}" already exists — pick another name or pass --yes to write into it.\n`);
    process.exit(1);
  }

  const tpl = TEMPLATES[template as keyof typeof TEMPLATES];
  console.log(`\n  ▸ creating ${name} (template: ${template})\n`);

  mkdirSync(target, { recursive: true });
  for (const f of tpl.files) {
    const p = join(target, f.path);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, f.content);
    console.log(`    + ${f.path}`);
  }

  const installCmd =
    pm === 'pnpm' ? 'pnpm install' : pm === 'yarn' ? 'yarn' : 'npm install';
  const devCmd =
    pm === 'pnpm' ? 'pnpm dev' : pm === 'yarn' ? 'yarn dev' : 'npm run dev';

  console.log(`
  ✔ done! next steps:

      cd ${name}
      ${installCmd}
      ${devCmd}

  → open http://localhost:5173
`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
