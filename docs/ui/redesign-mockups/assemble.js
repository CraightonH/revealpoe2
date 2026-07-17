const fs = require('fs');
const path = require('path');

const REPO = '/Users/chancock/git/poe2wiki';
const SCRATCH = '/private/tmp/claude-502/-Users-chancock-git-poe2wiki/2a0adb69-cd1c-45c7-aec0-3c7954358fd3/scratchpad';
const PUB = path.join(REPO, 'public');

const notes = { fontsInlined: [], fontsSkipped: [], imgsInlined: 0, imgsMissing: [], cssImgsInlined: [], cssImgsMissing: [] };

function readMaybe(p) { try { return fs.readFileSync(p); } catch { return null; } }
function mimeFor(f) {
  const e = f.toLowerCase();
  if (e.endsWith('.webp')) return 'image/webp';
  if (e.endsWith('.png')) return 'image/png';
  if (e.endsWith('.woff')) return 'font/woff';
  if (e.endsWith('.woff2')) return 'font/woff2';
  if (e.endsWith('.ttf')) return 'font/ttf';
  if (e.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}
function dataUri(buf, f) { return `data:${mimeFor(f)};base64,${buf.toString('base64')}`; }

// deterministic color from string
function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
  const hue = h % 360;
  return `hsl(${hue},45%,32%)`;
}
function initials(s) {
  const base = s.split('/').pop().replace(/\.\w+$/, '');
  const words = base.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_]+/).filter(Boolean);
  return (words.slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
}

// --- CSS: inline url(/static/img/...) refs ---
function inlineCssUrls(css) {
  return css.replace(/url\((['"]?)\/static\/img\/([^)'"]+)\1\)/g, (m, q, rel) => {
    const abs = path.join(PUB, 'img', rel);
    const buf = readMaybe(abs);
    if (buf) { notes.cssImgsInlined.push(rel); return `url(${dataUri(buf, rel)})`; }
    notes.cssImgsMissing.push(rel);
    return 'none';
  });
}

const tokens = fs.readFileSync(path.join(PUB, 'css/tokens.css'), 'utf8');
const app = inlineCssUrls(fs.readFileSync(path.join(PUB, 'css/app.css'), 'utf8'));
const gemCard = inlineCssUrls(fs.readFileSync(path.join(PUB, 'css/gem-card.css'), 'utf8'));

// --- fonts.css: inline @font-face src as data URIs ---
let fontsCss = fs.readFileSync(path.join(PUB, 'fonts.css'), 'utf8');
fontsCss = fontsCss.replace(/url\((['"]?)\/static\/fonts\/([^)'"]+)\1\)/g, (m, q, rel) => {
  const abs = path.join(PUB, 'fonts', rel);
  const buf = readMaybe(abs);
  if (!buf) { notes.fontsSkipped.push(rel + ' (missing)'); return 'url()'; }
  if (buf.length > 400 * 1024) { notes.fontsSkipped.push(rel + ' (>400KB)'); return m; }
  notes.fontsInlined.push(`${rel} (${(buf.length/1024).toFixed(0)}KB)`);
  return `url(${dataUri(buf, rel)})`;
});

// --- replace <img src="/static/img/..."> in an HTML chunk ---
function inlineImgs(html) {
  return html.replace(/<img\b[^>]*\bsrc="\/static\/img\/([^"]+)"[^>]*>/g, (tag, rel) => {
    const abs = path.join(PUB, 'img', rel);
    const buf = readMaybe(abs);
    // capture class + alt for placeholder / preserve
    const clsM = tag.match(/class="([^"]*)"/);
    const cls = clsM ? clsM[1] : '';
    const altM = tag.match(/alt="([^"]*)"/);
    const alt = altM ? altM[1] : rel;
    if (buf) {
      notes.imgsInlined++;
      return tag.replace(/src="\/static\/img\/[^"]+"/, `src="${dataUri(buf, rel)}"`);
    }
    notes.imgsMissing.push(rel);
    const color = hashColor(rel);
    const label = alt ? alt.slice(0, 2).toUpperCase() : initials(rel);
    return `<div class="${cls} img-placeholder" style="background:${color};display:inline-flex;align-items:center;justify-content:center;color:#fff;font:600 12px/1 sans-serif;" role="img" aria-label="${alt}">${label}</div>`;
  });
}

// --- extract gem cards by name from gems.html ---
const gems = fs.readFileSync(path.join(SCRATCH, 'gems.html'), 'utf8');
const cardRe = /<a class="gem-browse-card[\s\S]*?<\/a>/g;
const allCards = gems.match(cardRe) || [];
function findCard(name) {
  const needle = `>${name}</span>`;
  const c = allCards.find(x => x.includes(`class="gem-browse-name">${name}<`) || x.includes(needle));
  if (!c) throw new Error('card not found: ' + name);
  return c;
}
const wantNames = ["Alchemist&#39;s Boon", "Arc", "Archmage", "Arctic Armour", "Armour Breaker", "Artillery Ballista"];
const chosen = wantNames.map(findCard);
const cardsHtml = chosen.map(inlineImgs).join('\n');

// unique + base fragments
let uniqueCard = fs.readFileSync(path.join(SCRATCH, 'unique-card.html'), 'utf8');
let baseCard = fs.readFileSync(path.join(SCRATCH, 'base-card.html'), 'utf8');
uniqueCard = inlineImgs(uniqueCard);
baseCard = inlineImgs(baseCard);

// header + nav + filter bar (lifted verbatim from gems.html, lines 59-191)
const gemsLines = gems.split('\n');
const headerNav = gemsLines.slice(58, 102).join('\n');   // <header> ... </nav>
const titleBlock = gemsLines.slice(105, 191).join('\n');  // h1/subtitle + filter-bar
const sectionHeader = gemsLines[195]; // <h2 ...>Active Skills...

const footer = gemsLines.slice(47124, 47134).join('\n');

const doc = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reveal — UI reskin sample base</title>
<style id="fonts-css">
${fontsCss}
</style>
<style id="tokens-css">
${tokens}
</style>
<style id="app-css">
${app}
</style>
<style id="gem-card-css">
${gemCard}
</style>
</head>
<body>
${headerNav}
<main>
<div class="page page--column">
${titleBlock}
<section class="gem-list-section">
${sectionHeader}
<div class="gem-browse-grid">
${cardsHtml}
</div>
</section>

<section style="margin-top:3rem">
<h2 class="gem-list-heading">Unique tooltip sample</h2>
<div style="padding:1.5rem 0">
${uniqueCard}
</div>
</section>

<section style="margin-top:2rem">
<h2 class="gem-list-heading">Base item sample</h2>
<div style="padding:1.5rem 0">
${baseCard}
</div>
</section>
</div>
</main>
${footer}
</body>
</html>
`;

// strip any <script ...>...</script> and self-closing script tags
let out = doc.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<script\b[^>]*\/>/gi, '');

fs.writeFileSync(path.join(SCRATCH, 'sample.html'), out);

// sanity: count <img without data: src
const imgTags = out.match(/<img\b[^>]*>/g) || [];
const badImgs = imgTags.filter(t => !/src="data:/.test(t));
const size = Buffer.byteLength(out);

console.log(JSON.stringify({
  size, sizeMB: (size/1048576).toFixed(2),
  imgTagsTotal: imgTags.length, imgsWithoutDataSrc: badImgs.length,
  scriptTagsRemaining: (out.match(/<script/gi)||[]).length,
  cardsChosen: chosen.length,
  ...notes
}, null, 2));
fs.writeFileSync(path.join(SCRATCH, '_notes.json'), JSON.stringify(notes, null, 2));
