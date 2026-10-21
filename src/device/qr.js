/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Small QR code encoder (byte mode, error correction M, versions 1-20).
 * Used to show the "Pair with QR code" code for Android wireless debugging,
 * so no extra npm package is needed. Output: an SVG string.
 *
 * Follows ISO/IEC 18004 (the same steps as Project Nayuki's reference
 * implementation): data codewords -> Reed-Solomon blocks -> interleave ->
 * place modules -> try the 8 masks -> keep the lowest penalty.
 */

// Error correction level M: [ec codewords per block, number of blocks] for versions 1..20
const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const NUM_BLOCKS   = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const ECL_BITS_M = 0;   // format bits for level M

function numRawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const na = Math.floor(ver / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
function numDataCodewords(ver) {
  return Math.floor(numRawModules(ver) / 8) - EC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
}

/* ---------- Reed-Solomon over GF(256) ---------- */
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = new Array(div.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

/* ---------- Encoding ---------- */
function encodeData(bytes) {
  let ver = 1;
  for (; ver <= 20; ver++) {
    const cap = numDataCodewords(ver) * 8;
    const ccBits = ver < 10 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= cap) break;
  }
  if (ver > 20) throw new Error("Text too long for a QR code");
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0x4, 4);                                      // byte mode
  put(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach(b => put(b, 8));
  const cap = numDataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));           // terminator
  put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; words.push(v);
  }
  return { ver, words };
}

function addEcAndInterleave(ver, data) {
  const nb = NUM_BLOCKS[ver], ecLen = EC_PER_BLOCK[ver];
  const raw = Math.floor(numRawModules(ver) / 8);
  const shortBlocks = nb - raw % nb, shortLen = Math.floor(raw / nb);
  const div = rsDivisor(ecLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - ecLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ec = rsRemainder(dat, div);
    if (i < shortBlocks) dat.push(0);               // placeholder so all blocks line up
    blocks.push(dat.concat(ec));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - ecLen || j >= shortBlocks) out.push(b[i]); });
  }
  return out;
}

/* ---------- Matrix ---------- */
function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = ver * 4 + 10; r.length < n; pos -= step) r.splice(1, 0, pos);
  return r;
}

function buildMatrix(ver, codewords) {
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn  = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, v) => { mod[y][x] = v; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }   // timing
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = alignmentPositions(ver);
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  drawFormat(mod, fn, size, 0, true);               // reserve
  if (ver >= 7) drawVersion(mod, fn, size, ver);

  // Data, zig-zag from the bottom right
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) {
          mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
  return { size, mod, fn };
}

function drawFormat(mod, fn, size, mask, reserveOnly) {
  const data = (ECL_BITS_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const b = i => reserveOnly ? false : ((bits >>> i) & 1) === 1;
  const set = (x, y, v) => { mod[y][x] = v; fn[y][x] = true; };
  for (let i = 0; i <= 5; i++) set(8, i, b(i));
  set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
  set(8, size - 8, true);                            // dark module
}
function drawVersion(mod, fn, size, ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const v = ((bits >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3);
    mod[b][a] = v; fn[b][a] = true; mod[a][b] = v; fn[a][b] = true;
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
  (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0
];
function applyMask(m, k) {
  const out = m.mod.map(r => r.slice());
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++)
    if (!m.fn[y][x] && MASKS[k](x, y)) out[y][x] = !out[y][x];
  return out;
}
function penalty(g) {
  const n = g.length; let p = 0, dark = 0;
  const runs = line => {
    let s = 0, run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) run++;
      else { if (run >= 5) s += 3 + run - 5; run = 1; }
    }
    const t = line.map(v => v ? 1 : 0).join("");
    s += 40 * ((t.match(/(?=10111010000|00001011101)/g) || []).length);
    return s;
  };
  for (let y = 0; y < n; y++) p += runs(g[y]);
  for (let x = 0; x < n; x++) p += runs(g.map(r => r[x]));
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = g[y][x];
    if (c === g[y][x + 1] && c === g[y + 1][x] && c === g[y + 1][x + 1]) p += 3;
  }
  g.forEach(r => r.forEach(v => { if (v) dark++; }));
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

/** Encode text. Returns a 2-D array of booleans (true = dark). */
function matrix(text) {
  const bytes = [...Buffer.from(String(text), "utf8")];
  const { ver, words } = encodeData(bytes);
  const m = buildMatrix(ver, addEcAndInterleave(ver, words));
  let best = null, bestP = Infinity;
  for (let k = 0; k < 8; k++) {
    const g = applyMask(m, k);
    const t = { size: m.size, mod: g, fn: m.fn.map(r => r.slice()) };
    drawFormat(t.mod, t.fn, m.size, k, false);
    const pp = penalty(t.mod);
    if (pp < bestP) { bestP = pp; best = t.mod; }
  }
  return best;
}

/** SVG markup for the text (dark modules on a white quiet zone). */
function svg(text, opts) {
  const g = matrix(text), n = g.length, q = 4, dim = n + q * 2;
  const color = (opts && opts.color) || "#0b1220";
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[y][x]) d += "M" + (x + q) + " " + (y + q) + "h1v1h-1z";
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + " " + dim + '" shape-rendering="crispEdges" role="img" aria-label="QR code">' +
         '<rect width="100%" height="100%" fill="#ffffff"/><path fill="' + color + '" d="' + d + '"/></svg>';
}

module.exports = { matrix, svg };
