// A coloured ASCII render of a ringed gas giant with a moon, in the spirit of donut.c:
// sample surfaces, rotate, project onto a character grid with a z-buffer, then pick a
// character by brightness and a colour from a small palette. Returns animation frames
// where each cell is [char, colourIndex].

export const COLS = 76, ROWS = 36;

// Palette: each base colour comes in four brightness levels (index = base * 4 + level).
const BASES = {
  cream: [242, 227, 198], tan: [217, 160, 102], amber: [232, 184, 112], rust: [160, 82, 45], storm: [205, 72, 52],
  ring: [196, 210, 228], ringDim: [140, 150, 168], moon: [210, 210, 214], star: [235, 240, 255],
};
const LEVELS = [0.38, 0.62, 0.85, 1.0];
export const PALETTE = [];
const baseIndex = {};
for (const [name, rgb] of Object.entries(BASES)) {
  baseIndex[name] = PALETTE.length / 4;
  for (const k of LEVELS) PALETTE.push(rgb.map((c) => Math.round(c * k)));
}
export const paletteHex = PALETTE.map((c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''));

const RAMP = ' .:-=+*#%@';
const RING_RAMP = ' .:-=+'; // rings are thin: lighter glyphs, colour carries the brightness
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rotX = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const rotY = ([x, y, z], a) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
const LIGHT = norm([-0.55, 0.38, 0.75]);
const TILT = 0.44;
const RING = [1.24, 2.02], GAP = [1.68, 1.76]; // Saturn's proportions, in planet radii
const RING_N = rotX([0, 1, 0], TILT);
const MOON_R = 0.15, MOON_ORBIT = 2.12, MOON_TILT = TILT + 0.32;

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const STARS = Array.from({ length: 70 }, () => [Math.floor(rnd() * COLS), Math.floor(rnd() * ROWS), rnd()]);

const level = (lum) => (lum < 0.3 ? 0 : lum < 0.55 ? 1 : lum < 0.8 ? 2 : 3);
const char = (lum, ramp = RAMP) => ramp[Math.max(1, Math.min(ramp.length - 1, Math.round(lum * (ramp.length - 1))))];
const inRing = (r) => r >= RING[0] && r <= RING[1] && !(r > GAP[0] && r < GAP[1]) && !(r > 1.93 && r < 1.955);
// Optical depth by radius: faint C ring, bright B ring, the A ring outside the Cassini Division.
const ringDensity = (r) => (r < 1.5 ? 0.28 + 0.12 * Math.sin(r * 60) : r < GAP[0] ? 0.82 + 0.18 * Math.sin(r * 48) : 0.55 + 0.15 * Math.sin(r * 70));

// Gas-giant bands: latitude bands warped by longitude, with a storm oval.
function surface(lat, lon) {
  const warp = lat + 0.06 * Math.sin(lon * 4 + lat * 10) + 0.03 * Math.sin(lon * 11 - lat * 7);
  const b = Math.floor((warp + 1.6) * 5.2) % 5;
  const base = ['cream', 'tan', 'amber', 'rust', 'tan'][b];
  const dl = ((lon - 2.2) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  const sd = Math.hypot(dl / 0.42, (lat + 0.36) / 0.16);
  return sd < 1 ? { base: 'storm', tone: 0.85 + 0.15 * (1 - sd) } : { base, tone: 0.92 + 0.08 * Math.sin(warp * 37) };
}

export function frames(count) {
  const out = [];
  for (let f = 0; f < count; f++) out.push(frame(f / count));
  return out;
}

function frame(t) {
  const spin = t * Math.PI * 2;
  const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => [' ', -1]));
  const zbuf = Array.from({ length: ROWS }, () => Array(COLS).fill(-Infinity));
  const cx = COLS / 2, cy = ROWS / 2 + 0.5, sx = 17.6, sy = 9.0;
  const plot = (p, lum, base, ramp = RAMP) => {
    const x = Math.round(cx + p[0] * sx), y = Math.round(cy - p[1] * sy);
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS || p[2] <= zbuf[y][x]) return;
    zbuf[y][x] = p[2];
    const L = Math.min(1, Math.max(0.06, lum));
    grid[y][x] = [char(L, ramp), baseIndex[base] * 4 + level(L)];
  };

  for (const [x, y, k] of STARS) {
    const tw = Math.sin(k * 50 + t * Math.PI * 2 * 3);
    if (tw > -0.3) grid[y][x] = [tw > 0.75 ? '+' : tw > 0.2 ? '*' : '.', baseIndex.star * 4 + (tw > 0.5 ? 3 : 1)];
  }

  // Planet
  for (let lat = -Math.PI / 2; lat <= Math.PI / 2; lat += 0.018) {
    for (let lon = 0; lon < Math.PI * 2; lon += 0.012) {
      const local = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
      const n = rotX(rotY(local, spin), TILT);
      if (n[2] < 0) continue;
      const { base, tone } = surface(lat, lon);
      let lum = (Math.max(0, dot(n, LIGHT)) * 1.05 + 0.1) * tone * (0.7 + 0.3 * n[2]);
      // The rings' shadow on the planet: follow the light to the ring plane.
      const dn = dot(LIGHT, RING_N);
      if (Math.abs(dn) > 1e-3) {
        const s = -dot(n, RING_N) / dn;
        if (s > 0) {
          const h = [n[0] + LIGHT[0] * s, n[1] + LIGHT[1] * s, n[2] + LIGHT[2] * s];
          if (inRing(Math.hypot(...h))) lum *= 0.38;
        }
      }
      plot(n, lum, base);
    }
  }

  // Rings, with the planet's shadow across them
  for (let r = RING[0]; r <= RING[1]; r += 0.006) {
    if (!inRing(r)) continue;
    const density = ringDensity(r);
    for (let a = 0; a < Math.PI * 2; a += 0.009) {
      const p = rotX([r * Math.cos(a), 0, r * Math.sin(a)], TILT);
      const b = dot(p, LIGHT), c = dot(p, p) - 1;
      const shadow = b < 0 && b * b - c > 0;
      const lum = (Math.abs(dot(RING_N, LIGHT)) * 0.7 + 0.3) * density * (shadow ? 0.22 : 1);
      plot(p, lum, r < 1.5 ? 'ringDim' : 'ring', RING_RAMP);
    }
  }

  // Moon on an inclined orbit, one lap per loop so the animation is seamless
  const mc = rotX(rotY([MOON_ORBIT, 0, 0], -spin + 0.9), MOON_TILT);
  for (let lat = -Math.PI / 2; lat <= Math.PI / 2; lat += 0.12) {
    for (let lon = 0; lon < Math.PI * 2; lon += 0.1) {
      const n = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
      if (n[2] < 0) continue;
      const p = [mc[0] + n[0] * MOON_R, mc[1] + n[1] * MOON_R, mc[2] + n[2] * MOON_R];
      // Eclipsed when the planet sits between the moon and the light.
      const b = dot(mc, LIGHT), c = dot(mc, mc) - 1;
      const eclipsed = b < 0 && b * b - c > 0;
      plot(p, (Math.max(0, dot(n, LIGHT)) * 0.9 + 0.08) * (eclipsed ? 0.2 : 1), 'moon');
    }
  }
  return grid;
}
