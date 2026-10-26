/**
 * @zhenre/vite-plugin — build-time template precompilation for @zhenre
 *
 * Transforms every `html\`...\`` tagged template into a precompiled template
 * (slots computed at build time by @zhenre/compiler), so the runtime skips HTML
 * parsing + tree walking entirely. Behavior is byte-identical (parity suite
 * in @zhenre/compiler); the transform only removes cold-start work.
 *
 * Usage:
 *   // vite.config.ts
 *   import { defineConfig } from 'vite';
 *   import re from '@zhenre/vite-plugin';
 *   export default defineConfig({ plugins: [re()] });
 */

import { parse } from 'acorn';
import MagicString from 'magic-string';
import { compileTemplate } from '@zhenre/compiler';

export interface RePluginOptions {
  /** Tag function names to precompile (default: ['html']). */
  tags?: string[];
  /** Disable the transform (default false). */
  disabled?: boolean;
}

interface TagUse {
  start: number;
  end: number;
  /** cooked strings of the template quasis (null = invalid escape) */
  quasis: (string | null)[];
}

function findTagUses(code: string, tags: string[]): TagUse[] {
  const ast = parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: false,
  }) as unknown as AcornNode;
  const uses: TagUse[] = [];
  visit(ast, (node) => {
    if (
      node.type === 'TaggedTemplateExpression' &&
      node.tag?.type === 'Identifier' &&
      tags.includes(node.tag.name)
    ) {
      uses.push({
        start: node.start,
        end: node.end,
        quasis: node.quasi.quasis.map((q: AcornNode) => q.value?.cooked ?? null),
      });
    }
  });
  return uses;
}

interface AcornNode {
  type: string;
  start?: number;
  end?: number;
  tag?: AcornNode;
  quasi?: AcornNode;
  quasis?: AcornNode[];
  value?: { cooked?: string | null };
  [key: string]: unknown;
}

function visit(node: unknown, fn: (n: AcornNode) => void): void {
  if (node === null || typeof node !== 'object') return;
  const n = node as AcornNode;
  if (typeof n.type !== 'string') return;
  fn(n);
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const v = n[key];
    if (Array.isArray(v)) {
      for (const item of v) visit(item, fn);
    } else if (v !== null && typeof v === 'object') {
      visit(v, fn);
    }
  }
}

export default function rePlugin(opts: RePluginOptions = {}): {
  name: string;
  transform: (
    code: string,
    id: string,
  ) => Promise<{ code: string; map: unknown } | null> | { code: string; map: unknown } | null;
} {
  const tags = opts.tags ?? ['html'];
  return {
    name: 'vite-plugin-re',
    transform(code: string, id: string) {
      if (opts.disabled === true) return null;
      if (!/\.[cm]?[jt]sx?$/.test(id)) return null;
      if (id.includes('node_modules')) return null;
      if (!code.includes('html`') && !code.includes('html `')) return null;

      let uses: TagUse[];
      try {
        uses = findTagUses(code, tags);
      } catch {
        return null; // not parseable as ESM — leave untouched
      }
      if (uses.length === 0) return null;

      const s = new MagicString(code);
      const wires: string[] = [];
      let idx = 0;
      for (const use of uses) {
        const cooked = use.quasis;
        if (cooked.some((c) => c === null)) continue; // invalid escape — leave runtime path
        let slots: unknown;
        try {
          slots = compileTemplate(cooked as string[]).slots;
        } catch {
          continue;
        }
        const varName = `__re_wire_${idx}`;
        wires.push(
          `const ${varName} = __re_wire(${JSON.stringify(cooked)}, ${JSON.stringify(slots)});`,
        );
        // replace ONLY the tag identifier: first occurrence at use.start..
        // use.start is the tag start; tag length = 'html'.length — but the tag
        // may be any of `tags`; find its actual text length via the source.
        const tagText = code.slice(use.start, use.start + 8);
        const m = /^[A-Za-z_$][\w$]*/.exec(tagText);
        const tagLen = m ? m[0].length : 4;
        s.remove(use.start, use.start + tagLen);
        s.appendLeft(use.start, varName);
        idx++;
      }
      if (idx === 0) return null;
      s.prepend(`import { __wireTemplate as __re_wire } from '@zhenre/core';\n`);
      s.append(`\n${wires.join('\n')}\n`);
      return {
        code: s.toString(),
        map: s.generateMap({ hires: true }),
      };
    },
  };
}
