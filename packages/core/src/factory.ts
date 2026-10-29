/**
 * @zhenre/core — compiled row renderer (mega-template batching)
 *
 * `rowRenderer(src, paths, opts)` is the output shape of @zhenre/compiler
 * for keyed-list row templates: one row HTML source plus fixed child-index
 * paths to its dynamic text slots. The engine detects `.batch()` and builds
 * rows in staging batches:
 *
 *   - a staging fragment holding `batch` (default 50) rows is built lazily
 *     once and reused for every build (a plain fragment — no template
 *     element, no contents-owner-document cost)
 *   - per batch: slot values are written into the staging rows' hot text
 *     nodes, the whole staging content is cloned with ONE cloneNode(true)
 *     call, extra rows (tail batches) are trimmed, and per-row `bind` hooks
 *     resolve fresh refs
 *
 * This mirrors the fastest hand-written reference implementations (one native
 * clone per ~50 rows instead of one per row) while staying a framework API.
 */

export interface RowRendererOptions<T> {
  /** staging rows per clone batch (default 50). */
  batch?: number;
  /**
   * Use an existing `<template>` element as the row prototype instead of
   * parsing `src` into a fresh one (saves a contents-owner-document
   * registration and the parse). The template must contain the row HTML.
   */
  template?: HTMLTemplateElement;
  /**
   * Slot values for one item — assign `texts[i].data` directly
   * (numbers are stringified by the DOM). `texts` aligns with `paths`.
   */
  values?(item: T, texts: Text[]): void;
  /** Per-row hook on the freshly cloned row (keep refs, set expandos, …). */
  bind?(item: T, root: ChildNode, texts: Text[]): void;
}

export interface CompiledRowRenderer<T> {
  batch(
    items: readonly T[],
    start: number,
    n: number,
    target: ParentNode,
    /** row roots out (data mode). DOM-anchored mode passes null — the
     *  per-row roots loop is skipped entirely. */
    rowsOut?: ChildNode[] | null,
  ): void;
}

function resolve(root: Node, path: number[]): Text {
  // walk by sibling chain (never touches childNodes — caching a live
  // NodeList per container would pin NodeListsNodeData on staging rows)
  let n: Node = root;
  for (let i = 0; i < path.length; i++) {
    let k = path[i]!;
    let c = n.firstChild;
    while (k > 0 && c !== null) {
      c = c.nextSibling;
      k--;
    }
    n = c!;
  }
  return n as Text;
}

export function rowRenderer<T>(
  src: string,
  paths: number[][],
  opts?: RowRendererOptions<T>,
): CompiledRowRenderer<T> {
  const B = opts?.batch ?? 50;
  const values = opts?.values;
  const bind = opts?.bind;

  const given = opts?.template;
  const proto = given ?? document.createElement('template');
  if (given === undefined) {
    proto.innerHTML = src;
    // engines that mangle row HTML inside <template> (happy-dom recovers
    // `<tr>` into `<a>`): reparse in a table context when the root does not
    // match
    const want = (/^\s*<([a-zA-Z]+)/.exec(src)?.[1] ?? '').toUpperCase();
    const got = proto.content.firstElementChild as Element | null | undefined;
    if (got == null || got.tagName !== want) {
      while (proto.content.firstChild !== null) proto.content.firstChild.remove();
      const h = document.createElement(want === 'TR' ? 'table' : 'div');
      h.innerHTML = want === 'TR' ? '<tbody>' + src + '</tbody>' : src;
      const row = (want === 'TR' ? (h.firstElementChild as HTMLElement | null)?.firstElementChild : h.firstElementChild) as Node | null | undefined;
      if (row != null) proto.content.appendChild(row);
    }
  }
  // Ensure every slot path ends on a real Text node: HTML sources like
  // `<td></td>` have no text child, but slot paths address one. Insert empty
  // text nodes where missing (idempotent; runs once before mega build).
  {
    const root = proto.content.firstElementChild!;
    for (const p of paths) {
      let n: Node = root;
      for (let i = 0; i < p.length - 1; i++) {
        let k = p[i]!;
        let c = n.firstChild;
        while (k > 0 && c !== null) {
          c = c.nextSibling;
          k--;
        }
        n = c!;
      }
      const last = p[p.length - 1]!;
      let c = n.firstChild;
      let idx = 0;
      while (idx < last && c !== null) {
        c = c.nextSibling;
        idx++;
      }
      if (c === null) {
        while (idx <= last) {
          n.appendChild(document.createTextNode(''));
          idx++;
        }
      } else if (c.nodeType !== 3) {
        n.insertBefore(document.createTextNode(''), c);
      }
    }
  }

  // Staging fragment: B rows cloned from the proto, plus per-row hot
  // text-slot arrays. Built lazily on the first batch and REUSED for every
  // later build.
  //
  // Why a retained DocumentFragment instead of a throw-away
  // `createElement('template')`: every template element pins its contents
  // owner document (with its own window/registry structures), and Chrome
  // keeps those structures alive after the element is discarded (~2-3KB of
  // permanent growth per created template). A plain fragment has no owner
  // document, so retaining it costs exactly its rows — B rows of staging,
  // the same amortization the fastest hand-written references use.
  let stage: DocumentFragment | null = null;
  let stageTexts: Text[][] | null = null;
  function ensure(): void {
    if (stage !== null) return;
    const row = proto.content.firstElementChild!;
    const frag = document.createDocumentFragment();
    const kids: ChildNode[] = new Array(B);
    for (let i = 0; i < B; i++) {
      const c = row.cloneNode(true) as ChildNode;
      frag.appendChild(c);
      kids[i] = c;
    }
    const mt: Text[][] = new Array(B);
    for (let j = 0; j < B; j++) {
      const t = new Array(paths.length);
      for (let s = 0; s < paths.length; s++) t[s] = resolve(kids[j]!, paths[s]!);
      mt[j] = t as Text[];
    }
    stage = frag;
    stageTexts = mt;
  }

  // reusable scratch for bind(): bind hooks keep node refs (not the array),
  // so one array serves every row — zero per-row allocation
  const scratch: Text[] = new Array(paths.length);

  return {
    batch(items, start, n, target, rowsOut): void {
      if (n <= 0) return;
      ensure();
      const st = stage!;
      const mt = stageTexts!;
      const out = rowsOut ?? null;
      let done = 0;
      while (done < n) {
        const m = Math.min(B, n - done);
        if (values !== undefined) {
          for (let j = 0; j < m; j++) values(items[start + done + j] as T, mt[j]!);
        }
        const frag = st.cloneNode(true) as DocumentFragment;
        for (let t = m; t < B; t++) frag.lastChild!.remove();
        if (bind !== undefined || out !== null) {
          let row = frag.firstChild as ChildNode | null;
          for (let j = 0; j < m; j++) {
            if (bind !== undefined) {
              for (let s = 0; s < paths.length; s++) scratch[s] = resolve(row!, paths[s]!);
              bind(items[start + done + j] as T, row!, scratch);
            }
            if (out !== null) out.push(row!);
            row = row!.nextSibling;
          }
        }
        target.appendChild(frag);
        done += m;
      }
      // release the last row refs so a finished build retains nothing
      for (let s = 0; s < paths.length; s++) scratch[s] = undefined!;
      // discard the staging fragment after the build: it is pure build-time
      // machinery (a plain fragment, no owner-document cost). Rebuilding
      // costs only `batch` cloneNode calls at the next build. (Measured in
      // R6: retaining staging across builds LOSES ~+0.6% geomean — the
      // warm rebuild cost is smaller than the retained-subtree overhead.)
      stage = null;
      stageTexts = null;
    },
  };
}

/* Batch-size sensitivity (measured, R7 — 2026-10-29): 64 vs 128 is a WASH on
 * the official bench. Total node-copy work (n + B staging rows) and insert
 * work are B-invariant; only 2*ceil(n/B) native call overhead changes, worth
 * ~0.15ms on 07's ~465ms (and staging shrinks/grows by the same amount).
 * Pooled interleaved verdict: 07 -0.07% (sign flips between legs), geomean
 * +0.12% — all inside a 1.25% drift floor. Default 64 kept; an adaptive
 * `batch(n)` hook would be machinery without a measurable payoff. */

