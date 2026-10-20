(() => {
  // packages/core/src/template.ts
  var T_TEXT = 0;
  var T_ATTR = 1;
  var T_PARTS = 2;
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
  function __compileDebug(strings) {
    const htmlStr = joinHtml(strings);
    const content = buildContent(htmlStr);
    const slots = [];
    walk(content, [], slots);
    return { html: htmlStr, slots };
  }

  // <stdin>
  window.__compile = (strings) => __compileDebug(strings);
})();
