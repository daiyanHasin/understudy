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
  // Nothing unique and stable (typical: a text field whose placeholder Android doesn't report,
  // or an app without IDs): find it next to an element that IS findable, e.g. "below Password"
  if (!c.some(o => o.unique && !o.fragile)) relativeCandidates(nodes, target, c).forEach(o => c.push(o));
  // Unique and stable first, then "next to ...", then "Nth match", then not unique; the screen position is always last
  const rank = o => o.unique ? (o.fragile ? 1 : o.rel ? 0.5 : 0) : 2;
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

/* ======================= Relative targets (below / above / left of / right of) =======================
 * Maestro can find an element by where it is next to another one:
 *     - tapOn:
 *         below: "Password"          (the text, label or placeholder of the other element)
 *         index: 2                   (only when needed)
 * maestroFind() repeats how Maestro picks the element (Orchestra.buildFilter + Filters.kt):
 *   1. "basic" matches (id / text), deepest element only, in tree order; no id/text = every element
 *   2. keep those that are below / above / left of / right of ANY element matching the other one.
 *      Maestro compares the top-left corners: below = its top is lower than the other's top.
 *   3. with index: sorted top-to-bottom, then left-to-right, take that one; without index: clickable
 *      elements first (stable), take the first.
 * Every relative choice offered is checked with maestroFind() on this screen, so it is known to tap
 * the element that was clicked. When Maestro would pick another one, the index that fixes it is added.
 */
const REL_DIRS = ["below", "above", "rightOf", "leftOf"];
const REL_TEST = {
  below:   (n, a) => n.y1 > a.y1,
  above:   (n, a) => n.y1 < a.y1,
  leftOf:  (n, a) => n.x1 < a.x1,
  rightOf: (n, a) => n.x1 > a.x1
};
const REL_WORD = { below: "Below", above: "Above", leftOf: "Left of", rightOf: "Right of" };

function deepestInOrder(nodes, pred) {
  const hits = nodes.filter(pred);
  const hitSet = new Set(hits.map(n => n.i));
  const byI = new Map(nodes.map(n => [n.i, n]));
  const anc = new Set();
  hits.forEach(h => {
    let p = h.parent, guard = 0;
    while (p !== undefined && p >= 0 && guard++ < 200) {
      if (hitSet.has(p)) anc.add(p);
      const pn = byI.get(p); p = pn ? pn.parent : -1;
    }
  });
  return hits.filter(n => !anc.has(n.i)).sort((a, b) => a.i - b.i);
}

/** The elements Maestro would consider for a selector, in the order it picks them (first = chosen). */
function maestroFind(nodes, sel) {
  const all = nodes.slice().sort((a, b) => a.i - b.i);
  let res = sel.kind === "rel" ? all : deepestInOrder(all, n => selMatch(n, sel));
  if (sel.rel) {
    const anchors = maestroFind(nodes, { kind: sel.rel.kind, value: sel.rel.value });
    const test = REL_TEST[sel.rel.dir];
    res = res.filter(n => anchors.some(a => test(n, a)));
  }
  if (sel.index != null) {
    const sorted = res.map((n, k) => [n, k]).sort((x, y) => x[0].y1 - y[0].y1 || x[0].x1 - y[0].x1 || x[1] - y[1]).map(x => x[0]);
    return sorted[sel.index] ? [sorted[sel.index]] : [];
  }
  return res.map((n, k) => [n, k]).sort((x, y) => (y[0].clickable - x[0].clickable) || x[1] - y[1]).map(x => x[0]);
}

/** Does tapping `pick` (Maestro taps its centre) hit `target`? Same element, or one with the same box. */
function sameSpot(pick, target) {
  if (!pick) return false;
  if (pick.i === target.i) return true;
  const cx = (pick.x1 + pick.x2) / 2, cy = (pick.y1 + pick.y2) / 2;
  const tx = (target.x1 + target.x2) / 2, ty = (target.y1 + target.y2) / 2;
  return cx >= target.x1 && cx < target.x2 && cy >= target.y1 && cy < target.y2 &&
         tx >= pick.x1 && tx < pick.x2 && ty >= pick.y1 && ty < pick.y2;
}

/** Elements that make a good "next to" reference: findable by their own unique text, label or ID. */
function anchorsFor(nodes, target) {
  const byI = new Map(nodes.map(n => [n.i, n]));
  const related = n => {               // the target itself, inside it, or around it
    if (n.i === target.i) return true;
    for (const [a, b] of [[n, target], [target, n]]) {
      let p = a.parent, guard = 0;
      while (p !== undefined && p >= 0 && guard++ < 200) { if (p === b.i) return true; const pn = byI.get(p); p = pn ? pn.parent : -1; }
    }
    return false;
  };
  const out = [];
  nodes.forEach(n => {
    if (n.x2 <= n.x1 || n.y2 <= n.y1 || related(n)) return;
    const tries = [];
    if (n.text && n.text.length <= 60 && !n.editable) tries.push({ kind: "text", value: n.text });
    if (n.desc && n.desc.length <= 60) tries.push({ kind: "text", value: n.desc });
    if (n.hint && n.hint.length <= 60) tries.push({ kind: "text", value: n.hint });
    if (n.id) tries.push({ kind: "id", value: n.id });
    for (const t of tries) {
      const hits = deepestInOrder(nodes, x => selMatch(x, t));
      if (hits.length === 1 && hits[0].i === n.i) { out.push({ node: n, sel: t }); break; }
    }
  });
  return out;
}

/** Nearest findable element in each direction, as reference points. */
function nearest(anchors, target, dir) {
  const tcx = (target.x1 + target.x2) / 2, tcy = (target.y1 + target.y2) / 2;
  const vOverlap = a => Math.min(a.y2, target.y2) - Math.max(a.y1, target.y1) > 0;
  const hOverlap = a => Math.min(a.x2, target.x2) - Math.max(a.x1, target.x1) > 0;
  const scored = anchors.map(x => {
    const a = x.node, acx = (a.x1 + a.x2) / 2, acy = (a.y1 + a.y2) / 2;
    let d = null;
    // "below: A" means the target is below A, so A is above the target (and so on)
    if (dir === "below"   && REL_TEST.below(target, a))   d = Math.max(0, target.y1 - a.y2) + Math.abs(tcx - acx) * (hOverlap(a) ? 0.2 : 1);
    if (dir === "above"   && REL_TEST.above(target, a))   d = Math.max(0, a.y1 - target.y2) + Math.abs(tcx - acx) * (hOverlap(a) ? 0.2 : 1);
    if (dir === "rightOf" && REL_TEST.rightOf(target, a) && vOverlap(a)) d = Math.max(0, target.x1 - a.x2) + Math.abs(tcy - acy);
    if (dir === "leftOf"  && REL_TEST.leftOf(target, a)  && vOverlap(a)) d = Math.max(0, a.x1 - target.x2) + Math.abs(tcy - acy);
    return d === null ? null : { x, d };
  }).filter(Boolean).sort((p, q) => p.d - q.d);
  return scored.slice(0, 2).map(s => s.x);
}

/**
 * "Below Password"-style choices for `target`, each verified with maestroFind().
 * Returned as candidates: { kind, value, rel:{dir,kind,value}, index?, unique, fragile?, label }.
 */
function relativeCandidates(nodes, target, existing) {
  const scope = nodes;                                  // Maestro sees every window
  const window = nodes.filter(n => (n.win || 0) === (target.win || 0));
  const anchors = anchorsFor(scope, target);
  if (!anchors.length) return [];
  const bases = [{ kind: "rel" }];
  if (target.id) bases.unshift({ kind: "id", value: target.id });
  const stable = [], indexed = [];
  for (const dir of REL_DIRS) {
    for (const a of nearest(anchors, target, dir)) {
      for (const b of bases) {
        const sel = { kind: b.kind, value: b.kind === "rel" ? a.sel.value : b.value,
                      rel: { dir, kind: a.sel.kind, value: a.sel.value } };
        const what = a.sel.kind === "id" ? "ID " + a.sel.value.split(":id/").pop() : "\u201C" + a.sel.value + "\u201D";
        const label = (b.kind === "id" ? "ID " + b.value.split(":id/").pop() + " \u00b7 " : "") + REL_WORD[dir] + "  " + what;
        const ok = (list) => sameSpot(list[0], target);
        if (ok(maestroFind(scope, sel)) && (window.length === scope.length || ok(maestroFind(window, sel)))) {
          stable.push(Object.assign(sel, { unique: true, count: 1, label }));
        } else {
          // Which index would pick it? (sorted top-to-bottom, then left-to-right, like Maestro)
          const pool = maestroFind(scope, Object.assign({}, sel, { index: undefined }))
            .map((n, k) => [n, k]).sort((x, y) => x[0].y1 - y[0].y1 || x[0].x1 - y[0].x1 || x[1] - y[1]).map(x => x[0]);
          const k = pool.findIndex(n => sameSpot(n, target));
          if (k >= 0 && k <= 50) indexed.push(Object.assign(sel, { index: k, unique: true, count: 1, fragile: true,
                                                                   label: label + "  #" + (k + 1) }));
        }
        if (stable.length >= 3) break;
      }
    }
  }
  const dup = (o, list) => list.some(x => x.kind === o.kind && x.value === o.value && x.rel && o.rel &&
                                          x.rel.dir === o.rel.dir && x.rel.value === o.rel.value);
  const out = [];
  stable.concat(indexed.sort((x, y) => x.index - y.index)).forEach(o => {
    if (!dup(o, out) && !dup(o, existing || [])) out.push(o);
  });
  // A few good choices, not a long list: up to 3 that need no index, else 1 with an index
  return out.filter(o => !o.fragile).slice(0, 3).concat(out.some(o => !o.fragile) ? [] : out.filter(o => o.fragile).slice(0, 1));
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
  screenSize, nodesAt, inspect, suggestColumn, selMatch, matches, isInside, pointOnly, compactNodes,
  maestroFind, relativeCandidates, REL_DIRS
};
