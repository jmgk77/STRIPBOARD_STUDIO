// A tiny DOM shim (no dependencies) so the UI layer (src/ui/app.js) can be exercised under
// `node --test`. It implements just enough of the browser API that App uses: elements with
// attributes/dataset/classList/children, getElementById (auto-creating), createElement(NS),
// addEventListener + dispatch, SVG geometry stubs, localStorage and a few window globals.

class ClassList {
  constructor(value = "") {
    this.set = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  add(...c) {
    for (const x of c) this.set.add(x);
  }
  remove(...c) {
    for (const x of c) this.set.delete(x);
  }
  toggle(c, on) {
    const want = on === undefined ? !this.set.has(c) : on;
    if (want) this.set.add(c);
    else this.set.delete(c);
    return want;
  }
  contains(c) {
    return this.set.has(c);
  }
}

function matchSel(el, sel) {
  sel = sel.trim();
  if (sel.startsWith(".")) return el.classList.contains(sel.slice(1));
  if (sel.startsWith("#")) return el.id === sel.slice(1);
  const attr = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(sel);
  if (attr) {
    const [, name, value] = attr;
    const has = el.attrs[name] !== undefined;
    return value === undefined ? has : el.attrs[name] === value;
  }
  return el.tagName === sel.toUpperCase();
}

class El {
  constructor(tag, ns) {
    this.tagName = String(tag || "").toUpperCase();
    this.ns = ns;
    this.id = "";
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.classList = new ClassList();
    this._listeners = {};
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.open = false;
    this.textContent = "";
    this._innerHTML = "";
    this.parentElement = null;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === "class") this.classList = new ClassList(v);
    if (k.startsWith("data-")) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  appendChild(c) {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
  }
  insertBefore(c, ref) {
    const i = this.children.indexOf(ref);
    this.children.splice(i < 0 ? this.children.length : i, 0, c);
    c.parentElement = this;
    return c;
  }
  set innerHTML(v) {
    this._innerHTML = String(v);
    this.children = [];
  }
  get innerHTML() {
    return this._innerHTML;
  }
  addEventListener(type, fn) {
    (this._listeners[type] ??= []).push(fn);
  }
  removeEventListener() {}
  dispatch(type, ev) {
    const event = ev ?? { target: this, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false, key: "", pointerId: 1, clientX: 0, clientY: 0 };
    for (const fn of this._listeners[type] ?? []) fn(event);
  }
  click() {
    this.dispatch("click");
  }
  focus() {}
  blur() {}
  select() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  closest(sel) {
    let n = this;
    while (n) {
      if (matchSel(n, sel)) return n;
      n = n.parentElement;
    }
    return null;
  }
  querySelector(sel) {
    return queryAll(this, sel)[0] ?? null;
  }
  querySelectorAll(sel) {
    return queryAll(this, sel);
  }
  createSVGPoint() {
    return { x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) };
  }
  getScreenCTM() {
    return { inverse: () => ({}) };
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 200, height: 200 };
  }
}

function queryAll(root, sel) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (matchSel(c, sel)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** Install the shim into the globals this test process uses. */
export function installDom() {
  const byId = new Map();
  const body = new El("body");
  const documentElement = new El("html");
  const doc = new El("#document");
  const listeners = {};
  const storage = new Map();

  const getElementById = (id) => {
    if (!byId.has(id)) {
      const el = new El("div");
      el.id = id;
      byId.set(id, el);
    }
    return byId.get(id);
  };

  globalThis.document = {
    body,
    documentElement,
    title: "",
    activeElement: null,
    getElementById,
    createElement: (t) => new El(t),
    createElementNS: (ns, t) => new El(t, ns),
    createTextNode: (t) => {
      const e = new El("#text");
      e.textContent = String(t);
      return e;
    },
    addEventListener: (t, fn) => (listeners[t] ??= []).push(fn),
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    createRange: () => ({ selectNodeContents() {}, setStart() {}, setEnd() {} }),
    dispatch: (t, ev) => (listeners[t] ?? []).forEach((fn) => fn(ev ?? {})),
  };
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    prompt: () => null,
    confirm: () => true,
    open: () => null,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  };
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  globalThis.Blob = class {
    constructor(parts, opts) {
      this.parts = parts;
      this.type = opts?.type;
    }
  };
  globalThis.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  return { getElementById, byId, body, document: globalThis.document };
}
