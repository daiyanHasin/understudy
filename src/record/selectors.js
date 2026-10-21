/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Element picking: which element is under a point, the selector choices for it
 * (id, text, id + text, Nth match, screen position), following Maestro's own
 * matching rules so a recorded step finds the same element when it runs.
 */
const { area, contains } = require("./steps");

function screenSize(nodes) {
  let w = 1, h = 1;
  nodes.forEach(n => { if (n.x2 > w) w = n.x2; if (n.y2 > h) h = n.y2; });
  return { w, h };
}

/**
 * Nodes under a point, from the window on top only. With `dump --windows`
 * a dialog, the keyboard and the app behind it are all in the list: a tap
 * goes to the top window, so only its nodes count. Overlays that never take
 * touches (accessibility / magnification) are skipped.
 */
const PASSIVE_WIN = /ACCESSIBILITY_OVERLAY|MAGNIFICATION/;
function nodesAt(nodes, x, y) {
  const hit = nodes.filter(n => contains(n, x, y) && n.x2 > n.x1 && n.y2 > n.y1 && !PASSIVE_WIN.test(n.wtype || ""));
  if (!hit.length) return hit;
  let top = hit[0];
  hit.forEach(n => { if ((n.layer || 0) > (top.layer || 0)) top = n; });
  return hit.filter(n => (n.win || 0) === (top.win || 0));
}

function inspect(nodes, x, y) {
  const under = nodesAt(nodes, x, y).sort((a, b) => area(a) - area(b) || b.i - a.i);
  const size = screenSize(nodes);
  const pct = (v, t) => Math.max(0, Math.min(100, Math.round(v / t * 100)));
  const point = { kind: "point", value: pct(x, size.w) + "%," + pct(y, size.h) + "%", unique: true, count: 1, label: "Screen position" };
  if (!under.length) return { element: null, candidates: [point], size };

  const leaf = under[0];
  // A text field, or the placeholder text drawn inside one (Jetpack Compose draws it as a child)
  const field = under.find(n => n.editable && area(n) <= area(leaf) * 30);
  let target = field || leaf;
  if (!field) {
    for (const n of under.slice(0, 6)) {
      if ((n.id || n.text || n.desc || n.hint) && area(n) <= area(leaf) * 6) { target = n; break; }
    }
  }

  // Placeholder: hint attribute, else text drawn inside the field, else the field's own text
  // (older Android versions report an empty field's placeholder as its text)
  let placeholder = "";
  if (field) {
    const inner = nodes.find(n => n.parent === field.i && n.text && !n.editable) ||
                  (leaf !== field && leaf.text ? leaf : null);
    placeholder = field.hint || (inner ? inner.text : "") || (!field.focused ? field.text : "");
  }

  const same = nodes.filter(n => (n.win || 0) === (target.win || 0));      // uniqueness within the window
  const c = [];
  const add = (sel, label) => {
    if (!sel.value || sel.value.length > 120 || (sel.text && sel.text.length > 120)) return;
    if (c.some(o => o.kind === sel.kind && o.value === sel.value && (o.text || "") === (sel.text || ""))) return;
    const hits = matches(same, sel);
    const o = Object.assign({}, sel, { unique: hits.length <= 1, count: Math.max(hits.length, 1), label });
    if (hits.length > 1) {
      const k = hits.findIndex(h => h.i === target.i || isInside(same, h, target));
      if (k >= 0) o.pos = k;
    }
    c.push(o);
  };
  const idShort = target.id.split(":id/").pop();
  const shown = field ? "" : (target.text || target.desc);
  if (target.id) add({ kind: "id", value: target.id }, "ID  " + idShort);
  if (field) {
    add({ kind: "text", value: placeholder }, "Placeholder  \u201C" + placeholder + "\u201D");
    if (field.desc) add({ kind: "text", value: field.desc }, "Label  \u201C" + field.desc + "\u201D");
  } else {
    if (target.text) add({ kind: "text", value: target.text }, "Text  \u201C" + target.text + "\u201D");
    if (target.desc) add({ kind: "text", value: target.desc }, "Label  \u201C" + target.desc + "\u201D");
  }
  // A list of rows with the same ID: the ID plus the row's own text is usually unique
  if (target.id && shown && !c.some(o => o.unique)) add({ kind: "id", value: target.id, text: shown }, "ID + text  " + idShort + " \u201C" + shown + "\u201D");
  // Still nothing unique: the Nth match (top to bottom). Better than tapping the first match or a screen position.
  if (!c.some(o => o.unique)) {
    const best = c.find(o => o.pos !== undefined && !o.text);
    if (best) c.push({ kind: best.kind, value: best.value, index: best.pos, unique: true, count: 1, fragile: true,
                       label: best.label.split(/\s{2}/)[0] + " #" + (best.pos + 1) + " of " + best.count + "  " + best.label.split(/\s{2}/).slice(1).join("  ") });
  }
  c.forEach(o => { delete o.pos; });
  // Unique and stable first, then "Nth match", then not unique; the screen position is always last
  const rank = o => o.unique ? (o.fragile ? 1 : 0) : 2;
  c.sort((a, b) => rank(a) - rank(b));
  c.push(point);

  return {
    element: {
      id: target.id, idShort, text: field ? "" : target.text, desc: target.desc, hint: target.hint,
      placeholder, cls: target.cls.split(".").pop(), editable: !!field, password: target.password,
      pkg: target.pkg, bounds: [target.x1, target.y1, target.x2, target.y2],
      checked: target.checkable ? target.checked : undefined, enabled: target.enabled
    },
    suggestedColumn: suggestColumn(target, placeholder),
    candidates: c,
    size
  };
}

// "com.app:id/et_email" -> "Email", "Enter your password" -> "Password"
function suggestColumn(n, placeholder) {
  const fromId = n.id ? n.id.split(":id/").pop() : "";
  let s = (fromId.length >= 3 ? fromId : "") || placeholder || n.hint || n.desc || fromId || "";
  s = s.replace(/^(et|edt|edit|txt|input|tv|field|inp)[_\-]?/i, "")
       .replace(/[_\-](input|field|edit|text|et)$/i, "")
       .replace(/^(please\s+)?(enter|type|input|your)\s+(your\s+|the\s+)?/i, "");
  const words = s.split(/[^A-Za-z0-9]+|(?=[A-Z][a-z])/).filter(Boolean).slice(0, 3);
  let col = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  if (!col || !/^[A-Za-z_]/.test(col)) col = "Value" + (col || "");
  return col.slice(0, 40);
}

/*
 * Which elements Maestro would find for a selector, the way Maestro finds them:
 * text matches the text, the accessibility label or the hint; an element whose
 * child matches too is dropped (the deepest match wins); `index` counts the
 * matches top-to-bottom, then left-to-right.
 */
const hasText = (n, v) => n.text === v || n.desc === v || n.hint === v;
function selMatch(n, sel) {
  if (sel.kind === "id") return n.id === sel.value && (!sel.text || hasText(n, sel.text));
  return hasText(n, sel.value);
}
function matches(nodes, sel) {
  const hits = nodes.filter(n => n.x2 > n.x1 && n.y2 > n.y1 && selMatch(n, sel));
  const hitSet = new Set(hits.map(n => n.i));
  const byI = new Map(nodes.map(n => [n.i, n]));
  const ancestors = new Set();
  hits.forEach(h => {
    let p = h.parent, guard = 0;
    while (p !== undefined && p >= 0 && guard++ < 200) {
      if (hitSet.has(p)) ancestors.add(p);
      const pn = byI.get(p); p = pn ? pn.parent : -1;
    }
  });
  return hits.filter(n => !ancestors.has(n.i)).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
}
/** Is `n` the element `outer` or inside it? */
function isInside(nodes, n, outer) {
  const byI = new Map(nodes.map(x => [x.i, x]));
  let p = n.i, guard = 0;
  while (p !== undefined && p >= 0 && guard++ < 200) {
    if (p === outer.i) return true;
    const pn = byI.get(p); p = pn ? pn.parent : -1;
  }
  return false;
}

/** When the screen layout can't be read: the step still gets the screen position. */
function pointOnly(x, y, size, warning) {
  const pct = (v, t) => Math.max(0, Math.min(100, Math.round(v / t * 100)));
  return { element: null, size, warning: warning || "",
           candidates: [{ kind: "point", value: pct(x, size.w) + "%," + pct(y, size.h) + "%", unique: true, count: 1, label: "Screen position" }] };
}

/* ======================= Validation ======================= */

/* Compact node list for the live inspector (hover outlines in the window). */
function compactNodes(nodes) {
  return nodes.filter(n => n.x2 > n.x1 && n.y2 > n.y1).map(n => {
    const o = { i: n.i, p: n.parent, b: [n.x1, n.y1, n.x2, n.y2], c: n.cls.split(".").pop() };
    if (n.id) o.id = n.id; if (n.text) o.t = n.text.slice(0, 120); if (n.desc) o.d = n.desc.slice(0, 120);
    if (n.hint) o.h = n.hint.slice(0, 80); if (n.clickable) o.k = 1; if (n.editable) o.e = 1;
    if (n.scrollable) o.s = 1; if (n.password) o.pw = 1; if (n.win) o.w = n.win; if (n.layer) o.l = n.layer;
    if (n.pkg) o.pk = n.pkg; if (n.checkable) o.ck = n.checked ? 2 : 1; if (n.enabled === false) o.dis = 1;
    return o;
  });
}

module.exports = {
  screenSize, nodesAt, inspect, suggestColumn, selMatch, matches, isInside, pointOnly, compactNodes
};
