/**
 * @zhenre/compiler — reference template walker (JavaScript)
 *
 * Compiles a tagged-template's cooked strings into the slot descriptor the
 * @zhenre runtime consumes, WITHOUT a DOM: parse5 (spec-compliant HTML parser,
 * template fragment context) mirrors what every browser does with
 * `<template>` content, so output is byte-compatible with the runtime
 * compiler (enforced by fixture parity tests).
 *
 * The Zig implementation (zig/re_template.zig) must produce identical output.
 */

import { parseFragment } from 'parse5';

export interface CompiledSlot {
  /** 0 = child text/node binding, 1 = attr/event/ref, 2 = interpolated attr */
  k: 0 | 1 | 2;
  /** binding index into vals */
  i?: number;
  /** child-index path from the template root */
  p: number[];
  /** attribute name */
  n?: string;
  /** interpolated parts (string literal | binding index) */
  parts?: (string | number)[];
}

export interface CompileResult {
  html: string;
  slots: CompiledSlot[];
}

const MARKER_RE = /\u0001(\d+)\u0002/g;
const MARKER_FULL_RE = /^\u0001(\d+)\u0002$/;

/** Join cooked strings with markers — must match @zhenre/core template.ts exactly. */
export function joinHtml(strings: readonly string[]): string {
  let out = strings[0] ?? '';
  for (let i = 1; i < strings.length; i++) {
    out += '\u0001' + (i - 1) + '\u0002' + strings[i];
  }
  return out;
}

/* parse5 tree nodes (structural typing, no adapter overhead) */
interface P5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
  content?: { childNodes: P5Node[] };
}

function childrenOf(n: P5Node): P5Node[] {
  // <template> stores its content under .content, exactly like the DOM.
  if (n.nodeName === 'template') return n.content?.childNodes ?? [];
  return n.childNodes ?? [];
}

function walk(parent: P5Node, base: number[], slots: CompiledSlot[]): void {
  const cn = childrenOf(parent);
  let i = 0;
  while (i < cn.length) {
    const n = cn[i]!;
    if (n.nodeName === '#text') {
      const data = n.value ?? '';
      if (data.indexOf('\u0001') >= 0) {
        const segs: P5Node[] = [];
        const re = MARKER_RE;
        re.lastIndex = 0;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(data)) !== null) {
          if (m.index > last) {
            segs.push({ nodeName: '#text', value: data.slice(last, m.index) });
          }
          const j = segs.length;
          segs.push({ nodeName: '#text', value: '' });
          slots.push({ k: 0, i: +m[1]!, p: [...base, i + j] });
          last = m.index + m[0].length;
        }
        if (last < data.length) {
          segs.push({ nodeName: '#text', value: data.slice(last) });
        }
        cn.splice(i, 1, ...segs);
        i += segs.length;
        continue;
      }
    } else if (n.nodeName !== '#comment' && n.nodeName !== '#documentType') {
      const attrs = n.attrs ?? [];
      for (let a = 0; a < attrs.length; a++) {
        const attr = attrs[a]!;
        const val = attr.value;
        if (val.indexOf('\u0001') < 0) continue;
        const sm = MARKER_FULL_RE.exec(val);
        const p = [...base, i];
        if (sm !== null) {
          slots.push({ k: 1, i: +sm[1]!, n: attr.name, p });
        } else {
          const parts: (string | number)[] = [];
          const re2 = MARKER_RE;
          re2.lastIndex = 0;
          let last = 0;
          let m2: RegExpExecArray | null;
          while ((m2 = re2.exec(val)) !== null) {
            if (m2.index > last) parts.push(val.slice(last, m2.index));
            parts.push(+m2[1]!);
            last = m2.index + m2[0].length;
          }
          if (last < val.length) parts.push(val.slice(last));
          slots.push({ k: 2, n: attr.name, parts, p });
        }
      }
      walk(n, [...base, i], slots);
    }
    i++;
  }
}

/**
 * Compile cooked template strings into runtime slots.
 * Throws when the template cannot be represented losslessly (empty input).
 */
export function compileTemplate(strings: readonly string[]): CompileResult {
  if (strings.length === 0) {
    throw new Error('[re/compiler] empty template');
  }
  const html = joinHtml(strings);
  // parse5's parseFragment uses the <template> fragment context by default —
  // the same algorithm browsers apply to <template> content.
  const frag = parseFragment(html) as unknown as P5Node;
  const slots: CompiledSlot[] = [];
  walk(frag, [], slots);
  return { html, slots };
}
