#!/usr/bin/env node
/**
 * Generates the map pin artwork in assets/pins/ — no design tool or image
 * library needed, shapes are described as point-in-shape tests below.
 *
 * Two families of PNG per part (the teardrop `body`, plus one glyph per pin
 * style):
 *   sdf-<part>.png   signed-distance fields for MapLibre symbol layers. Only the
 *                    alpha channel matters; the layer tints them with `icon-color`
 *                    (the body takes the pin's colour, glyphs are white), and
 *                    `icon-halo-*` draws the white outline around the body.
 *   mask-<part>.png  ordinary anti-aliased silhouettes for React Native UI (the
 *                    style picker), tinted with `Image`'s `tintColor`.
 *
 * SDF encoding is MapLibre's: alpha = 0.75 at the edge, 1/8 of a unit per pixel
 * of distance (inside positive), so the halo/edge shader constants line up.
 *
 * Usage: node tools/build_pin_icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

/** Canvas every part is drawn on; the tip of the pin touches the bottom edge (icon-anchor: bottom). */
const W = 64;
const H = 80;
/** Supersampling factor for the distance transform / anti-aliasing. */
const SS = 4;
/** SDF spread in output pixels: alpha covers [-6, +2] px around the edge. */
const SDF_SPREAD = 8;
const SDF_EDGE = 0.75;

const HEAD = { x: 32, y: 28, r: 22 };
const TIP = { x: 32, y: 77 };

// --- shape primitives (all take a point and answer "inside?") -------------------------------

const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** Even-odd point-in-polygon. */
const polygon = (points) => (x, y) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const union = (...shapes) => (x, y) => shapes.some((s) => s(x, y));
const minus = (a, ...holes) => (x, y) => a(x, y) && !holes.some((h) => h(x, y));

function star(cx, cy, outer, inner, points = 5) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return polygon(pts);
}

// --- parts ---------------------------------------------------------------------------------

// Tangent points from the tip to the head circle give the teardrop's straight sides.
const tipDistance = TIP.y - HEAD.y;
const tangentAngle = Math.acos(HEAD.r / tipDistance);
const tangentDx = HEAD.r * Math.sin(tangentAngle);
const tangentDy = HEAD.r * Math.cos(tangentAngle);
const body = union(
  circle(HEAD.x, HEAD.y, HEAD.r),
  polygon([
    [TIP.x, TIP.y],
    [HEAD.x - tangentDx, HEAD.y + tangentDy],
    [HEAD.x + tangentDx, HEAD.y + tangentDy],
  ])
);

/** Glyphs sit inside the head circle (centre 32,28, radius 22) — keep every stroke ≥ 5px. */
const glyphs = {
  pin: circle(32, 28, 8.5),
  camp: minus(
    polygon([
      [32, 15],
      [47, 41],
      [17, 41],
    ]),
    polygon([
      [32, 27],
      [38, 41],
      [26, 41],
    ])
  ),
  water: union(
    circle(32, 32, 9.5),
    polygon([
      [32, 14],
      [22.8, 29],
      [41.2, 29],
    ])
  ),
  stand: union(rect(18, 17, 46, 25), rect(21, 25, 27, 43), rect(37, 25, 43, 43), rect(27, 32, 37, 37)),
  trailhead: union(
    rect(28, 15, 34, 43),
    polygon([
      [28, 18],
      [44, 18],
      [50, 24],
      [44, 30],
      [28, 30],
    ])
  ),
  peak: polygon([
    [16, 42],
    [28, 20],
    [34, 30],
    [39, 23],
    [48, 42],
  ]),
  star: star(32, 29, 14, 6),
  flag: union(
    rect(21, 15, 27, 43),
    polygon([
      [27, 17],
      [46, 23],
      [27, 31],
    ])
  ),
  hazard: minus(
    polygon([
      [32, 14],
      [48, 42],
      [16, 42],
    ]),
    rect(29.5, 24, 34.5, 34),
    circle(32, 38, 2.8)
  ),
};

// --- rasterising -------------------------------------------------------------------------------

/** Squared 1-D distance transform (Felzenszwalb & Huttenlocher). `f` holds 0 or a large sentinel. */
function edt1d(f, n, out, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    out[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

/** Euclidean distance from every cell to the nearest cell where `mask` is true (Infinity if none). */
function distanceToMask(mask, w, h) {
  const BIG = 1e12;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] ? 0 : BIG;

  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  for (let i = 0; i < grid.length; i++) grid[i] = Math.sqrt(grid[i]);
  return grid;
}

function rasterise(shape) {
  const w = W * SS;
  const h = H * SS;
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (shape((x + 0.5) / SS, (y + 0.5) / SS)) inside[y * w + x] = 1;
    }
  }
  return { inside, w, h };
}

/** Anti-aliased coverage per output pixel (0-255). */
function maskAlpha(shape) {
  const { inside, w } = rasterise(shape);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let count = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) count += inside[(y * SS + sy) * w + x * SS + sx];
      out[y * W + x] = Math.round((count / (SS * SS)) * 255);
    }
  }
  return out;
}

/** MapLibre-style SDF alpha per output pixel (0-255). */
function sdfAlpha(shape) {
  const { inside, w, h } = rasterise(shape);
  const outside = inside.map((v) => (v ? 0 : 1));
  const toInside = distanceToMask(inside, w, h); // for outside cells: distance to the shape
  const toOutside = distanceToMask(outside, w, h); // for inside cells: distance to the background
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Sample the centre of the output pixel from the supersampled field.
      const hx = x * SS + SS / 2;
      const hy = y * SS + SS / 2;
      const i = Math.min(h - 1, Math.floor(hy)) * w + Math.min(w - 1, Math.floor(hx));
      // Signed distance in output pixels, positive inside; the -0.5 puts the edge between cells.
      const signed = inside[i] ? (toOutside[i] - 0.5) / SS : -(toInside[i] - 0.5) / SS;
      const alpha = SDF_EDGE + signed / SDF_SPREAD;
      out[y * W + x] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }
  }
  return out;
}

// --- PNG writer --------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Encodes a white RGBA image whose alpha channel is `alpha`. `rgb` may override the colour (previews). */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function whiteWithAlpha(alpha) {
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = alpha[i];
  }
  return rgba;
}

// --- main --------------------------------------------------------------------------------------

const outDir = path.join(import.meta.dirname, '..', 'assets', 'pins');
await mkdir(outDir, { recursive: true });

const parts = { body, ...glyphs };
for (const [name, shape] of Object.entries(parts)) {
  await writeFile(path.join(outDir, `sdf-${name}.png`), encodePng(W, H, whiteWithAlpha(sdfAlpha(shape))));
  await writeFile(path.join(outDir, `mask-${name}.png`), encodePng(W, H, whiteWithAlpha(maskAlpha(shape))));
  console.log(`${name}: sdf + mask`);
}

// A contact sheet for eyeballing the result (not used by the app): every style, tinted, on grey.
const sheetCols = Object.keys(glyphs).length;
const sheetW = sheetCols * W;
const sheet = Buffer.alloc(sheetW * H * 4);
for (let i = 0; i < sheetW * H; i++) {
  sheet[i * 4] = 205;
  sheet[i * 4 + 1] = 210;
  sheet[i * 4 + 2] = 200;
  sheet[i * 4 + 3] = 255;
}
const bodyMask = maskAlpha(body);
Object.keys(glyphs).forEach((name, col) => {
  const glyphMask = maskAlpha(glyphs[name]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * sheetW + col * W + x) * 4;
      const blend = (alpha, r, g, b) => {
        const a = alpha / 255;
        sheet[o] = Math.round(sheet[o] * (1 - a) + r * a);
        sheet[o + 1] = Math.round(sheet[o + 1] * (1 - a) + g * a);
        sheet[o + 2] = Math.round(sheet[o + 2] * (1 - a) + b * a);
      };
      blend(bodyMask[y * W + x], 0xe1, 0x1d, 0x48);
      blend(glyphMask[y * W + x], 255, 255, 255);
    }
  }
});
if (process.argv.includes('--sheet')) {
  const sheetPath = process.argv[process.argv.indexOf('--sheet') + 1];
  await writeFile(sheetPath, encodePng(sheetW, H, sheet));
  console.log(`Wrote contact sheet ${sheetPath}`);
}
