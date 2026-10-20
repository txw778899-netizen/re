(() => {
  // packages/core/src/signal.ts
  var active = null;
  var batching = false;
  var notifyDepth = 0;
  var queue = /* @__PURE__ */ new Map();
  var SIG = Symbol("re.signal");
  var owner = { current: null };
  function isSignal(v) {
    return typeof v === "object" && v !== null && v instanceof SignalImpl;
  }
  function dropDeps(sub) {
    const deps = sub.deps;
    if (deps) {
      for (const owner2 of deps) owner2.$unsub(sub);
      sub.deps = null;
    }
  }
  function notify(subs, v) {
    for (let i = 0; i < subs.length; i++) subs[i].run(v);
  }
  var SignalImpl = class {
    [SIG] = 1;
    _own;
    _v;
    _subs = null;
    constructor(initial) {
      this._v = initial;
      this._own = owner.current;
    }
    get value() {
      const a = active;
      if (a !== null) {
        const deps = a.deps ?? (a.deps = /* @__PURE__ */ new Set());
        if (!deps.has(this)) {
          deps.add(this);
          if (this._subs === null) this._subs = [a];
          else this._subs.push(a);
        }
      }
      return this._v;
    }
    set value(nv) {
      const subs = this._subs;
      if (Object.is(nv, this._v)) return;
      this._v = nv;
      if (subs === null) return;
      if (batching) {
        for (let i = 0; i < subs.length; i++) queue.set(subs[i], nv);
        return;
      }
      if (++notifyDepth > 150) {
        notifyDepth = 0;
        throw new Error("[re] signal update depth exceeded (circular update?)");
      }
      try {
        notify(subs, nv);
      } finally {
        notifyDepth--;
      }
    }
    peek() {
      return this._v;
    }
    setQuiet(nv) {
      this._v = nv;
    }
    $sub(s) {
      if (this._subs === null) this._subs = [s];
      else this._subs.push(s);
    }
    $unsub(s) {
      const subs = this._subs;
      if (subs === null) return;
      const i = subs.indexOf(s);
      if (i >= 0) {
        const last = subs.pop();
        if (i < subs.length) subs[i] = last;
      }
    }
  };
  function signal(initial) {
    return new SignalImpl(initial);
  }
  function effect(fn) {
    const e = {
      deps: null,
      run() {
        rerun();
      }
    };
    function rerun() {
      dropDeps(e);
      const prev = active;
      active = e;
      try {
        fn();
      } finally {
        active = prev;
      }
    }
    rerun();
    return () => {
      dropDeps(e);
    };
  }

  // packages/core/src/template.ts
  var T_TEXT = 0;
  var T_ATTR = 1;
  var T_PARTS = 2;
  var ReFragment = class extends DocumentFragment {
    root = null;
    disposers = null;
    mounts = null;
    dispose() {
      const d = this.disposers;
      if (d !== null) {
        this.disposers = null;
        for (let i = 0; i < d.length; i++) d[i]();
      }
    }
  };
  var cache = /* @__PURE__ */ new WeakMap();
  var precompiled = /* @__PURE__ */ new Map();
  var MARKER_RE = /\u0001(\d+)\u0002/g;
  var MARKER_FULL_RE = /^\u0001(\d+)\u0002$/;
  function joinHtml(strings) {
    let out = strings[0] ?? "";
    for (let i = 1; i < strings.length; i++) {
      out += "" + (i - 1) + "" + strings[i];
    }
    return out;
  }
  function walk(parent, base, slots) {
    let i = 0;
    const cn = parent.childNodes;
    while (i < cn.length) {
      const n = cn[i];
      const nt = n.nodeType;
      if (nt === 3) {
        const data = n.data;
        if (data.indexOf("") >= 0) {
          const frag = document.createDocumentFragment();
          const re = MARKER_RE;
          re.lastIndex = 0;
          let last = 0;
          let m;
          while ((m = re.exec(data)) !== null) {
            if (m.index > last) {
              frag.appendChild(document.createTextNode(data.slice(last, m.index)));
            }
            const j = frag.childNodes.length;
            frag.appendChild(document.createTextNode(""));
            const p = [...base, i + j];
            slots.push({ k: T_TEXT, i: +m[1], p });
            last = m.index + m[0].length;
          }
          if (last < data.length) {
            frag.appendChild(document.createTextNode(data.slice(last)));
          }
          parent.replaceChild(frag, n);
          i += frag.childNodes.length;
          continue;
        }
      } else if (nt === 1) {
        const el = n;
        const attrs = el.attributes;
        for (let a = 0; a < attrs.length; a++) {
          const attr = attrs[a];
          const val = attr.value;
          if (val.indexOf("") < 0) continue;
          const sm = MARKER_FULL_RE.exec(val);
          const p = [...base, i];
          if (sm !== null) {
            slots.push({ k: T_ATTR, i: +sm[1], n: attr.name, p });
          } else {
            const parts = [];
            const re2 = MARKER_RE;
            re2.lastIndex = 0;
            let last = 0;
            let m2;
            while ((m2 = re2.exec(val)) !== null) {
              if (m2.index > last) parts.push(val.slice(last, m2.index));
              parts.push(+m2[1]);
              last = m2.index + m2[0].length;
            }
            if (last < val.length) parts.push(val.slice(last));
            slots.push({ k: T_PARTS, n: attr.name, parts, p });
          }
        }
        if (el.tagName === "TEMPLATE") {
          walk(el.content, [...base, i], slots);
        } else {
          walk(el, [...base, i], slots);
        }
      }
      i++;
    }
  }
  function buildContent(htmlStr) {
    const el = document.createElement("template");
    el.innerHTML = htmlStr;
    return el.content;
  }
  function compile(strings) {
    const content = buildContent(joinHtml(strings));
    const slots = [];
    walk(content, [], slots);
    return { content, slots };
  }
  function buildCompiled(strings, slots) {
    return { content: buildContent(joinHtml(strings)), slots };
  }
  function fmt(v) {
    if (typeof v === "string") return v;
    if (v == null) return "";
    return String(v);
  }
  function setPropOrAttr(el, name, v) {
    if (name === "class") {
      el.className = fmt(v);
      return;
    }
    if (name === "style") {
      el.style.cssText = fmt(v);
      return;
    }
    if (name in el) {
      try {
        el[name] = v;
        return;
      } catch {
      }
    }
    el.setAttribute(name, fmt(v));
  }
  function wireAttr(el, name, v, frag) {
    if (typeof v === "function") {
      if (name.charCodeAt(0) === 111 && name.charCodeAt(1) === 110) {
        if (name in el) {
          el[name] = v;
        } else {
          el.addEventListener(name.slice(2), v);
        }
      } else if (name === "ref") {
        v(el);
      } else {
        setPropOrAttr(el, name, v);
      }
      return;
    }
    if (isSignal(v)) {
      const sub = {
        run(nv) {
          setPropOrAttr(el, name, nv);
        }
      };
      setPropOrAttr(el, name, v.value);
      v.$sub(sub);
      if (v._own !== owner.current) {
        const sig = v;
        if (frag.disposers === null) frag.disposers = [];
        frag.disposers.push(() => {
          sig.$unsub(sub);
        });
      }
      return;
    }
    setPropOrAttr(el, name, v);
  }
  function locate(root, path) {
    let n = root;
    for (let k = 0; k < path.length; k++) {
      n = n.childNodes[path[k]];
    }
    return n;
  }
  function instantiate(c, vals) {
    const frag = new ReFragment();
    const clone = c.content.cloneNode(true);
    while (clone.firstChild !== null) frag.appendChild(clone.firstChild);
    frag.root = frag.firstChild;
    const slots = c.slots;
    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s];
      const node = locate(frag, slot.p);
      if (slot.k === T_TEXT) {
        const t = node;
        const v = vals[slot.i];
        if (isSignal(v)) {
          t.data = fmt(v.value);
          const sub = {
            run(nv) {
              t.data = fmt(nv);
            }
          };
          v.$sub(sub);
          if (v._own !== owner.current) {
            const sig = v;
            if (frag.disposers === null) frag.disposers = [];
            frag.disposers.push(() => {
              sig.$unsub(sub);
            });
          }
        } else if (typeof v === "function") {
          if (frag.disposers === null) frag.disposers = [];
          frag.disposers.push(
            effect(() => {
              t.data = fmt(v());
            })
          );
        } else if (v !== null && typeof v === "object") {
          const eachDir = v;
          if (eachDir._$each === true) {
            const view = eachDir._mount(t);
            if (frag.mounts === null) frag.mounts = [];
            frag.mounts.push(() => view.mount());
            if (frag.disposers === null) frag.disposers = [];
            frag.disposers.push(() => view.dispose());
          } else if (v instanceof Node) {
            t.parentNode.insertBefore(v, t);
            t.remove();
            if (v instanceof ReFragment) {
              if (v.mounts !== null) {
                if (frag.mounts === null) frag.mounts = [];
                for (let k = 0; k < v.mounts.length; k++) frag.mounts.push(v.mounts[k]);
              }
              if (v.disposers !== null) {
                if (frag.disposers === null) frag.disposers = [];
                for (let k = 0; k < v.disposers.length; k++) frag.disposers.push(v.disposers[k]);
              }
            }
          } else {
            throw new Error("[re] unsupported child binding type: " + v.constructor?.name);
          }
        } else {
          t.data = fmt(v);
        }
      } else if (slot.k === T_ATTR) {
        wireAttr(node, slot.n, vals[slot.i], frag);
      } else {
        const el = node;
        const name = slot.n;
        const parts = slot.parts;
        if (frag.disposers === null) frag.disposers = [];
        frag.disposers.push(
          effect(() => {
            let out = "";
            for (let j = 0; j < parts.length; j++) {
              const part = parts[j];
              if (typeof part === "number") {
                const pv = vals[part];
                out += isSignal(pv) ? fmt(pv.value) : fmt(pv);
              } else {
                out += part;
              }
            }
            setPropOrAttr(el, name, out);
          })
        );
      }
    }
    return frag;
  }
  function html(strings, ...vals) {
    let compiled = cache.get(strings);
    if (compiled === void 0) {
      const pre = precompiled.get(strings.join("\0"));
      compiled = pre !== void 0 ? buildCompiled(strings, pre) : compile(strings);
      cache.set(strings, compiled);
    }
    return instantiate(compiled, vals);
  }
  function append(parent, ...nodes) {
    const pending = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n === null || n === void 0 || n === false) continue;
      parent.appendChild(n);
      if (n instanceof ReFragment) {
        const m = n.mounts;
        if (m !== null) {
          for (let k = 0; k < m.length; k++) pending.push(m[k]);
        }
      }
    }
    for (let i = 0; i < pending.length; i++) pending[i]();
  }

  // packages/core/src/each.ts
  var KeyedView = class {
    anchor;
    _list;
    _isSig;
    _key;
    _render;
    _map = /* @__PURE__ */ new Map();
    _last = [];
    _sub = null;
    _mounted = false;
    /** creation-context token: signals born during row render die with the row */
    _ctx = {};
    constructor(anchor, list2, key, render) {
      this.anchor = anchor;
      this._list = list2;
      this._isSig = isSig(list2);
      this._key = key;
      this._render = render;
    }
    /** The anchor's real parent, resolved lazily — never stale. */
    get _pn() {
      return this.anchor.parentNode;
    }
    /** Called once the anchor is in its final parent (via append()/mount()). */
    mount() {
      if (this._mounted) return;
      this._mounted = true;
      const parent = this.anchor.parentNode;
      if (parent !== null) {
        let c = parent.firstChild;
        while (c !== null) {
          const next = c.nextSibling;
          if (c !== this.anchor && c.nodeType === 3 && c.data.trim() === "") {
            parent.removeChild(c);
          }
          c = next;
        }
      }
      const initial = this._isSig ? this._list.peek() : this._list;
      if (this._isSig) {
        const view = this;
        this._sub = {
          run(v) {
            view.sync(v);
          }
        };
        this._list.$sub(this._sub);
      }
      this.sync(initial);
    }
    /* ---------------------------------------------------------------- */
    /* reactive sync (declarative path)                                  */
    /* ---------------------------------------------------------------- */
    sync(next) {
      if (!this._mounted) this.mount();
      const old = this._last;
      if (next === old && this._isSig) return;
      if (next.length === 0) {
        this._clearAll();
        this._commit(next);
        return;
      }
      if (old.length === 0) {
        this._appendAll(next);
        this._commit(next);
        return;
      }
      const key = this._key;
      if (next.length > old.length) {
        let prefix = true;
        for (let i = 0; i < old.length; i++) {
          if (key(old[i]) !== key(next[i])) {
            prefix = false;
            break;
          }
        }
        if (prefix) {
          this._appendAll(next.slice(old.length));
          this._commit(next);
          return;
        }
      }
      let common = false;
      const map = this._map;
      for (let i = 0; i < next.length; i++) {
        if (map.has(key(next[i]))) {
          common = true;
          break;
        }
      }
      if (!common) {
        this._replaceAll(next);
        this._commit(next);
        return;
      }
      this._diff(next);
      this._commit(next);
    }
    /** Signal mode keeps the array reference; plain-array mode takes a snapshot. */
    _commit(next) {
      this._last = this._isSig ? next : next.slice();
    }
    _diff(next) {
      const map = this._map;
      const parent = this._pn;
      const key = this._key;
      const nextKeys = /* @__PURE__ */ new Set();
      for (let i = 0; i < next.length; i++) nextKeys.add(key(next[i]));
      if (map.size !== 0) {
        for (const [k, e] of map) {
          if (!nextKeys.has(k)) {
            e.fr?.dispose();
            e.root.remove();
            map.delete(k);
          }
        }
      }
      let ref = this.anchor;
      for (let i = 0; i < next.length; i++) {
        const item = next[i];
        const k = key(item);
        let e = map.get(k);
        if (e === void 0) {
          e = this._create(item);
          map.set(k, e);
        }
        const r = e.root;
        if (ref.nextSibling !== r) parent.insertBefore(r, ref.nextSibling);
        this._runMounts(e);
        ref = r;
      }
    }
    /* ---------------------------------------------------------------- */
    /* O(1) direct ops (imperative path)                                 */
    /* ---------------------------------------------------------------- */
    ref(key) {
      return this._map.get(key)?.root ?? null;
    }
    get size() {
      return this._map.size;
    }
    /** Swap two rows by key in O(1). Updates the source list quietly. */
    swap(ka, kb) {
      if (ka === kb) return;
      const ea = this._map.get(ka);
      const eb = this._map.get(kb);
      if (ea === void 0 || eb === void 0) return;
      if (!this._mounted) this.mount();
      const a = ea.root;
      const b = eb.root;
      const bFollows = (a.compareDocumentPosition(b) & 4) !== 0;
      const x = bFollows ? a : b;
      const y = bFollows ? b : a;
      const parent = this._pn;
      const yNext = y.nextSibling;
      parent.insertBefore(y, x);
      parent.insertBefore(x, yNext);
      this._applyListSwap(ka, kb);
    }
    _applyListSwap(ka, kb) {
      const key = this._key;
      const arr = this._last;
      let ia = -1;
      let ib = -1;
      for (let i = 0; i < arr.length; i++) {
        const k = key(arr[i]);
        if (k === ka) ia = i;
        else if (k === kb) ib = i;
        if (ia >= 0 && ib >= 0) break;
      }
      if (ia >= 0 && ib >= 0) {
        const tmp = arr[ia];
        arr[ia] = arr[ib];
        arr[ib] = tmp;
        if (this._isSig) {
          this._list.setQuiet(arr);
        } else {
          const ua = this._list;
          let ja = -1;
          let jb = -1;
          for (let i = 0; i < ua.length; i++) {
            const k = key(ua[i]);
            if (k === ka) ja = i;
            else if (k === kb) jb = i;
            if (ja >= 0 && jb >= 0) break;
          }
          if (ja >= 0 && jb >= 0) {
            const t2 = ua[ja];
            ua[ja] = ua[jb];
            ua[jb] = t2;
          }
        }
      }
    }
    /** Remove one row by key in O(1). Updates the source list quietly. */
    remove(key) {
      const e = this._map.get(key);
      if (e === void 0) return;
      if (!this._mounted) this.mount();
      e.fr?.dispose();
      e.root.remove();
      this._map.delete(key);
      const keyFn = this._key;
      const arr = this._last;
      for (let i = 0; i < arr.length; i++) {
        if (keyFn(arr[i]) === key) {
          arr.splice(i, 1);
          break;
        }
      }
      if (this._isSig) {
        this._list.setQuiet(arr);
      } else {
        const ua = this._list;
        for (let i = 0; i < ua.length; i++) {
          if (keyFn(ua[i]) === key) {
            ua.splice(i, 1);
            break;
          }
        }
      }
    }
    dispose() {
      if (this._sub !== null) {
        this._list.$unsub(this._sub);
        this._sub = null;
      }
      this._clearAll();
      if (this._isSig) this._list.setQuiet([]);
      this._mounted = false;
    }
    /* ---------------------------------------------------------------- */
    /* internals                                                         */
    /* ---------------------------------------------------------------- */
    _create(item) {
      const prev = owner.current;
      owner.current = this._ctx;
      let r;
      try {
        r = this._render(item);
      } finally {
        owner.current = prev;
      }
      if (r instanceof ReFragment) {
        return { root: r.root ?? r, fr: r, item };
      }
      return { root: r, fr: null, item };
    }
    /** Deferred directive mounts (nested each) run after final placement. */
    _runMounts(e) {
      const fr = e.fr;
      if (fr !== null && fr.mounts !== null) {
        const m = fr.mounts;
        fr.mounts = null;
        for (let i = 0; i < m.length; i++) m[i]();
      }
    }
    _appendAll(items) {
      const key = this._key;
      const map = this._map;
      const parent = this._pn;
      const gp = parent.parentNode;
      const detached = gp !== null && items.length >= 32 && parent.isConnected === true && parent.firstChild === this.anchor && parent.lastChild === this.anchor;
      const ref = detached ? parent.nextSibling : null;
      if (detached) gp.removeChild(parent);
      const stage = detached ? null : document.createDocumentFragment();
      const target = detached ? parent : stage;
      const created = detached ? [] : null;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const e = this._create(item);
        map.set(key(item), e);
        target.appendChild(e.root);
        if (created !== null) created.push(e);
      }
      if (detached) {
        gp.insertBefore(parent, ref);
        for (let i = 0; i < created.length; i++) this._runMounts(created[i]);
      } else {
        parent.insertBefore(stage, null);
      }
    }
    _replaceAll(next) {
      const map = this._map;
      const parent = this._pn;
      const key = this._key;
      const existing = map.size;
      const ownedOnly = parent.childNodes.length === existing + 1 && this.anchor.parentNode === parent;
      for (const [, e] of map) e.fr?.dispose();
      if (!ownedOnly) {
        for (const [, e] of map) {
          if (e.root.parentNode === parent) e.root.remove();
        }
      }
      map.clear();
      const stage = document.createDocumentFragment();
      for (let i = 0; i < next.length; i++) {
        const item = next[i];
        const e = this._create(item);
        map.set(key(item), e);
        stage.appendChild(e.root);
      }
      if (ownedOnly) {
        parent.replaceChildren(this.anchor, stage);
      } else {
        parent.insertBefore(stage, null);
      }
    }
    _clearAll() {
      const map = this._map;
      const parent = this._pn;
      if (parent.childNodes.length === map.size + 1 && this.anchor.parentNode === parent) {
        for (const [, e] of map) e.fr?.dispose();
        parent.replaceChildren(this.anchor);
      } else {
        for (const [, e] of map) {
          e.fr?.dispose();
          e.root.remove();
        }
      }
      map.clear();
    }
  };
  function isSig(v) {
    return typeof v === "object" && v !== null && typeof v.peek === "function" && typeof v.$sub === "function";
  }
  function each(list2, key, render) {
    const dir = {
      _$each: true,
      _view: null,
      _mount(anchor) {
        const view = new KeyedView(anchor, list2, key, render);
        dir._view = view;
        return view;
      },
      sync(next) {
        dir._view?.sync(next);
      },
      ref(key2) {
        return dir._view?.ref(key2) ?? null;
      },
      swap(ka, kb) {
        dir._view?.swap(ka, kb);
      },
      remove(key2) {
        dir._view?.remove(key2);
      },
      get size() {
        return dir._view?.size ?? 0;
      }
    };
    return dir;
  }

  // bench/harness/micro.ts
  function _random(max) {
    return Math.round(Math.random() * 1e3) % max;
  }
  var ADJ = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive", "cheap", "expensive", "fancy"];
  var COL = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
  var NOUN = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse", "keyboard"];
  var idSeq = 1;
  function buildData(count) {
    const data = new Array(count);
    for (let i = 0; i < count; i++) {
      data[i] = { id: idSeq++, label: signal(ADJ[_random(ADJ.length)] + " " + COL[_random(COL.length)] + " " + NOUN[_random(NOUN.length)]) };
    }
    return data;
  }
  var rows = signal([]);
  var rowTpl = (r) => {
    const f = html`<tr><td class="col-md-1">${r.id}</td><td class="col-md-4"><a>${r.label}</a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr>`;
    f.root.data_id = r.id;
    return f;
  };
  var list = each(rows, (r) => r.id, rowTpl);
  var tbody = document.getElementById("tbody");
  append(tbody, html`${list}`);
  var raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  async function run() {
    const out = {};
    rows.value = buildData(1e3);
    rows.value = [];
    await raf();
    const build = [];
    const syncT = [];
    const paint = [];
    for (let i = 0; i < 8; i++) {
      rows.value = [];
      await raf();
      const t0 = performance.now();
      const data = buildData(1e4);
      const t1 = performance.now();
      rows.value = data;
      const t2 = performance.now();
      await raf();
      const t3 = performance.now();
      build.push(t1 - t0);
      syncT.push(t2 - t1);
      paint.push(t3 - t2);
    }
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    out.build10k_ms = med(build).toFixed(2);
    out.sync10k_ms = med(syncT).toFixed(2);
    out.paint10k_ms = med(paint).toFixed(2);
    rows.value = [];
    await raf();
    const inst = [];
    for (let i = 0; i < 5; i++) {
      const data = buildData(1e4);
      const t0 = performance.now();
      const frags = new Array(data.length);
      for (let j = 0; j < data.length; j++) frags[j] = rowTpl(data[j]);
      const t1 = performance.now();
      inst.push(t1 - t0);
      rows.value = data;
      await raf();
      rows.value = [];
      await raf();
    }
    out.instantiate10k_ms = med(inst).toFixed(2);
    const cloneOnly = [];
    for (let i = 0; i < 5; i++) {
      const tr = rowTpl(buildData(1)[0]);
      const t0 = performance.now();
      const arr = new Array(1e4);
      for (let j = 0; j < 1e4; j++) arr[j] = tr.cloneNode(true);
      const t1 = performance.now();
      cloneOnly.push(t1 - t0);
    }
    out.cloneOnly10k_ms = med(cloneOnly).toFixed(2);
    const plain = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const arr = new Array(1e4);
      for (let j = 0; j < 1e4; j++) {
        arr[j] = { id: idSeq++, label: ADJ[_random(ADJ.length)] + " " + COL[_random(COL.length)] + " " + NOUN[_random(NOUN.length)] };
      }
      const t1 = performance.now();
      plain.push(t1 - t0);
    }
    out.buildPlain10k_ms = med(plain).toFixed(2);
    return out;
  }
  var btn = document.createElement("button");
  btn.textContent = "run";
  btn.onclick = async () => {
    const r = await run();
    document.title = JSON.stringify(r);
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(r, null, 2);
    document.body.appendChild(pre);
  };
  document.body.appendChild(btn);
})();
