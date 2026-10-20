// Builds the profile card: a spinning ASCII ringed planet beside a neofetch-style
// summary with live GitHub stats. Writes card/dark.svg and card/light.svg.
//
//   GITHUB_TOKEN=... node card/build.mjs
//
// Runs daily in .github/workflows/card.yml. No dependencies; Node 18+.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USER = 'ibiraza1077-pixel';
const here = (f) => fileURLToPath(new URL(f, import.meta.url));

/* ============================== the planet ============================== */
// A z-buffered renderer in the spirit of donut.c: sample the surface of a banded
// gas giant and its rings, rotate, project to a character grid, shade by light.
const COLS = 50, ROWS = 22, FRAMES = 36;
const RAMP = ' .,-~:;=!*#$@';
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const LIGHT = norm([-0.65, 0.55, 0.75]);
const TILT = 0.52; // the whole system leans towards the viewer
const rotX = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const rotY = ([x, y, z], a) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];

let s = 7;
const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const stars = Array.from({ length: 34 }, () => [Math.floor(rand() * COLS), Math.floor(rand() * ROWS), rand()]);

function planetFrame(f) {
  const spin = (f / FRAMES) * Math.PI * 2;
  const chars = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
  const depth = Array.from({ length: ROWS }, () => Array(COLS).fill(-Infinity));
  const cx = COLS / 2, cy = ROWS / 2 + 0.5, sx = 13.2, sy = 6.1; // character cells are about 2.2× taller than wide
  const plot = (p, lum) => {
    const x = Math.round(cx + p[0] * sx), y = Math.round(cy - p[1] * sy);
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS || p[2] <= depth[y][x]) return;
    depth[y][x] = p[2];
    chars[y][x] = RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.round(lum * (RAMP.length - 1))))];
  };
  // Background stars twinkle frame to frame.
  for (const [x, y, k] of stars) chars[y][x] = (Math.sin(k * 40 + f * 0.7) > 0.55 ? '+' : Math.sin(k * 40 + f * 0.7) > -0.2 ? '.' : ' ');
  // Planet: latitude bands that wobble with longitude, plus a storm that rolls past as it spins.
  for (let phi = -Math.PI / 2; phi <= Math.PI / 2; phi += 0.035) {
    for (let th = 0; th < Math.PI * 2; th += 0.03) {
      const n0 = [Math.cos(phi) * Math.cos(th), Math.sin(phi), Math.cos(phi) * Math.sin(th)];
      const n = rotX(rotY(n0, spin), TILT);
      if (n[2] < -0.05) continue;
      const band = Math.sin(phi * 9 + Math.sin(th * 3 + phi * 4) * 0.6) * 0.18;
      const sd = Math.hypot((((th - 1.2) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI, (phi + 0.35) * 2.2);
      const storm = sd < 0.45 ? -0.35 * (1 - sd / 0.45) : 0;
      const lum = Math.max(0.03, dot(n, LIGHT)) * 0.95 + band + storm + 0.1;
      plot([n[0], n[1], n[2]], Math.min(1, Math.max(0.04, lum)));
    }
  }
  // Rings with a Cassini-style gap, in the planet's shadow where the light is blocked.
  const ringNormal = rotX([0, 1, 0], TILT);
  for (let r = 1.32; r <= 1.86; r += 0.008) {
    if (r > 1.6 && r < 1.65) continue;
    const density = 0.55 + 0.45 * Math.sin(r * 31) * Math.sin(r * 7);
    for (let a = 0; a < Math.PI * 2; a += 0.012) {
      const p = rotX(rotY([r * Math.cos(a), 0, r * Math.sin(a)], spin * 0.35), TILT);
      // Shadow test: does a ray from p towards the light hit the unit sphere?
      const b = dot(p, LIGHT), c = dot(p, p) - 1;
      const shadow = b < 0 && b * b - c > 0;
      const lum = (Math.abs(dot(ringNormal, LIGHT)) * 0.75 + 0.2) * density * (shadow ? 0.25 : 1);
      plot(p, Math.min(1, Math.max(0.05, lum)));
    }
  }
  return chars.map((r) => r.join(''));
}

/* ============================== GitHub stats ============================== */
const token = process.env.GITHUB_TOKEN;
const headers = { 'User-Agent': `${USER}-profile-card`, Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function graphql(query) {
  const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers, body: JSON.stringify({ query }) });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// Per-repo contributor stats give this user's commits, additions and deletions.
// GitHub computes them lazily and answers 202 until they are ready.
async function contributorStats(repo) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`https://api.github.com/repos/${USER}/${repo}/stats/contributors`, { headers });
    if (res.status === 202) { await sleep(3000); continue; }
    if (res.status === 204) return { c: 0, a: 0, d: 0 };
    if (!res.ok) return null;
    const me = (await res.json()).find((x) => x.author && x.author.login === USER);
    if (!me) return { c: 0, a: 0, d: 0 };
    return me.weeks.reduce((t, w) => ({ c: t.c + w.c, a: t.a + w.a, d: t.d + w.d }), { c: 0, a: 0, d: 0 });
  }
  return null;
}

async function stats() {
  const cachePath = here('cache.json');
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { repos: {} };
  // privacy: PUBLIC keeps private repos out of the card and its cache even when run with a personal token.
  const data = await graphql(`{ user(login: "${USER}") {
    createdAt followers { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) { totalCount nodes { name stargazerCount } }
    repositoriesContributedTo(first: 1, includeUserRepositories: true, contributionTypes: [COMMIT, PULL_REQUEST, REPOSITORY]) { totalCount }
  } }`);
  const u = data.user;
  let commits = 0, add = 0, del = 0;
  const fresh = {}; // rebuilt every run, so the cache only ever names the public repos counted
  for (const { name } of u.repositories.nodes) {
    // Reuse the last good numbers for a repo if GitHub has not finished computing them.
    const st = (await contributorStats(name)) || cache.repos[name] || { c: 0, a: 0, d: 0 };
    fresh[name] = st;
    commits += st.c; add += st.a; del += st.d;
  }
  writeFileSync(cachePath, JSON.stringify({ repos: fresh }, null, 1) + '\n');
  return {
    createdAt: new Date(u.createdAt),
    repos: u.repositories.totalCount,
    contributed: u.repositoriesContributedTo.totalCount,
    stars: u.repositories.nodes.reduce((n, r) => n + r.stargazerCount, 0),
    followers: u.followers.totalCount,
    commits, add, del,
  };
}

function uptime(from, to = new Date()) {
  let y = to.getUTCFullYear() - from.getUTCFullYear();
  let m = to.getUTCMonth() - from.getUTCMonth();
  let d = to.getUTCDate() - from.getUTCDate();
  if (d < 0) { m -= 1; d += new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0)).getUTCDate(); }
  if (m < 0) { y -= 1; m += 12; }
  const part = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return [y ? part(y, 'year') : null, part(m, 'month'), part(d, 'day')].filter(Boolean).join(', ');
}

/* ============================== the card ============================== */
const WIDTH = 64; // characters in an info line
const fmt = (n) => n.toLocaleString('en-GB');

function infoLines(st) {
  // Each line is a list of [text, class] segments. Dot leaders pad keys to values.
  // value is a string, or a list of [text, class] segments when parts need their own colour.
  const kv = (key, value) => {
    const segs = typeof value === 'string' ? [[value, 'value']] : value;
    const len = segs.reduce((n, [t]) => n + t.length, 0);
    const dots = Math.max(2, WIDTH - key.length - len - 4);
    return [['. ', 'cc'], [key, 'key'], [':', 'cc'], [' ' + '.'.repeat(dots) + ' ', 'cc'], ...segs];
  };
  const rule = (label) => [[label ? `- ${label} ` : '', 'head'], ['—'.repeat(Math.max(2, WIDTH - (label ? label.length + 3 : 0))), 'cc']];
  return [
    [['ibrahim', 'head'], ['@', 'cc'], ['raza', 'head'], [' ' + '—'.repeat(WIDTH - 13), 'cc']],
    kv('OS', 'macOS · Apple Silicon M4'),
    kv('Uptime', uptime(st.createdAt)),
    kv('Host', 'BSc Computer Science · final year'),
    kv('Kernel', 'Go 1.23 → OakDB (SQL from scratch)'),
    kv('Shell', 'oakdb=> · speaks PostgreSQL'),
    kv('Status', 'seeking graduate SWE roles · 2027'),
    [['', 'cc']],
    kv('Languages.Programming', 'Go, TypeScript, Python, SQL, JS'),
    kv('Languages.Frameworks', 'React, Express, FastAPI, Socket.IO'),
    kv('Languages.AI', 'MLX Whisper, Claude API, OpenCV'),
    kv('Infra', 'Postgres, Docker, Cloudflare, Vercel'),
    [['', 'cc']],
    rule('Live demos'),
    kv('OakDB', 'database, compiled to WebAssembly'),
    kv('Viral.Clipper', 'one prompt → narrated video'),
    kv('Portfolio', '3D site with a SQL terminal'),
    [['', 'cc']],
    rule('Contact'),
    kv('Email', 'ibiraza1077@gmail.com'),
    kv('LinkedIn', 'ibrahimraza-dev'),
    [['', 'cc']],
    rule('GitHub Stats'),
    [...kv('Repos', `${st.repos} {Contributed: ${st.contributed}} | Stars: ${fmt(st.stars)}`)],
    [...kv('Commits', `${fmt(st.commits)} | Followers: ${fmt(st.followers)}`)],
    kv('Lines of Code', [[`${fmt(st.add - st.del)} ( `, 'value'], [`${fmt(st.add)}++`, 'add'], [', ', 'value'], [`${fmt(st.del)}--`, 'del'], [' )', 'value']]),
  ];
}

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function svg(theme, st, frames) {
  const C = theme === 'dark'
    ? { bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#c9d1d9', cc: '#5d6772', key: '#ffb547', value: '#a5d6ff', head: '#e6edf3', add: '#3fb950', del: '#f85149', planet: '#c9d1d9' }
    : { bg: '#ffffff', panel: '#f6f8fa', border: '#d0d7de', text: '#24292f', cc: '#9aa3ad', key: '#b35900', value: '#0550ae', head: '#1f2328', add: '#1a7f37', del: '#cf222e', planet: '#24292f' };
  const FONT = 14, LH = 18.5, CW = 8.43; // monospace metrics used for layout
  const lines = infoLines(st);
  const infoY = 34;
  const height = Math.round(lines.length * LH + 44);
  const artX = 26, artY = Math.round((height - ROWS * LH * 0.98) / 2 + FONT * 0.8);
  const infoX = artX + COLS * CW + 30;
  const longest = Math.max(...lines.map((segs) => segs.reduce((n, [t]) => n + t.length, 0)));
  const width = Math.round(infoX + longest * CW + 34);
  const dur = (FRAMES * 0.11).toFixed(2);
  const frameCss = frames.map((_, i) => `.f${i}{animation-delay:${(-(FRAMES - i) * 0.11).toFixed(2)}s}`).join('');
  const frameSvg = frames.map((rows, i) => `<g class="f f${i}">${rows.map((r, y) => `<text x="${artX}" y="${artY + y * LH * 0.98}">${esc(r)}</text>`).join('')}</g>`).join('');
  const info = lines.map((segs, i) => `<text class="ln" x="${infoX}" y="${infoY + i * LH}">${segs.map(([t, c]) => `<tspan class="${c}">${esc(t)}</tspan>`).join('')}</text>`).join('');
  const lastY = infoY + (lines.length - 1) * LH;
  const lastLen = lines.at(-1).reduce((n, [t]) => n + t.length, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Ibrahim Raza: final-year CS student, seeking graduate software engineering roles in 2027. ${st.repos} repositories, ${fmt(st.commits)} commits.">
<style>
text{font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace;font-size:${FONT}px;white-space:pre;fill:${C.text}}
.f text{fill:${C.planet}}
.f{opacity:0;animation:fr ${dur}s steps(1,end) infinite}.f0{opacity:1}
@keyframes fr{0%{opacity:1}${(100 / FRAMES).toFixed(3)}%{opacity:0}100%{opacity:0}}
${frameCss}
.cc{fill:${C.cc}}.key{fill:${C.key}}.value{fill:${C.value}}.head{fill:${C.head};font-weight:700}.add{fill:${C.add}}.del{fill:${C.del}}
.cur{fill:${C.key};animation:blink 1s steps(1,end) infinite}
@keyframes blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){.f,.cur{animation:none}}
</style>
<rect width="${width}" height="${height}" rx="12" fill="${C.panel}" stroke="${C.border}"/>
${frameSvg}
${info}
<rect class="cur" x="${(infoX + lastLen * CW + 4).toFixed(1)}" y="${lastY - FONT + 3}" width="${CW.toFixed(1)}" height="${FONT + 2}"/>
</svg>
`;
}

/* ============================== main ============================== */
const frames = Array.from({ length: FRAMES }, (_, f) => planetFrame(f));
const st = await stats();
writeFileSync(here('dark.svg'), svg('dark', st, frames));
writeFileSync(here('light.svg'), svg('light', st, frames));
console.log(`card: ${st.repos} repos, ${st.stars} stars, ${st.commits} commits, +${st.add} -${st.del}, uptime ${uptime(st.createdAt)}`);
if (process.argv.includes('--preview')) console.log(frames[0].join('\n'));
