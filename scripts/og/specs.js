// Collects OG card specs from the graph for the page kinds whose links carry
// the most share value: gems, uniques, and base items. Reuses the live view
// model builders so a card's text can't drift from the page it previews.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodesByKind } from '../../src/data/graph.js';
import { buildGemViewModel } from '../../src/data/gems.js';
import { buildUniqueViewModel } from '../../src/data/uniques.js';
import { buildBaseItemViewModel } from '../../src/data/baseItems.js';
import { ddsUrl } from '../../src/data/images.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const UNIQUE_ACCENT = '#af6025';
const UNIQUE_GLOW = 'rgba(175,96,37,0.35)';
const NORMAL_ACCENT = '#c8c8c8';

// Map a renderable image reference (/static/img/...webp URL, or a raw .dds path)
// to the local file the build wrote, or null. The fetcher mirrors art into
// public/img, served at /static/img — so strip the /static prefix back to disk.
function localArt(ref) {
  if (!ref) return null;
  const url = ref.startsWith('/') ? ref : ddsUrl(ref);
  if (!url || !url.startsWith('/static/')) return null;
  return path.join(root, 'public', url.replace(/^\/static\//, ''));
}

// Strip rendered HTML (keyword spans, mod-value spans) back to plain text, and
// split on the newlines RePoE embeds in multi-line stat strings.
function plainLines(html) {
  if (!html) return [];
  const text = String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  return text
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function gemSpec(slug) {
  const vm = buildGemViewModel(slug);
  if (!vm) return null;
  const lines = [
    ...plainLines(vm.description),
    ...vm.sections.flatMap((s) => s.lines.flatMap(plainLines)),
  ];
  return {
    kind: 'gem',
    slug,
    spec: {
      name: vm.name,
      typeLine: vm.typeLine,
      lines,
      accent: vm.borderColor || NORMAL_ACCENT,
      glow: vm.glowColor || 'rgba(120,160,255,0.3)',
      artPath: localArt(vm.gemIconUrl || vm.skillIconUrl || vm.hoverImageUrl),
    },
  };
}

function uniqueSpec(slug, node) {
  const vm = buildUniqueViewModel(slug);
  if (!vm) return null;
  const lines = [...vm.implicits, ...vm.explicits].map((m) => m.text).filter(Boolean);
  return {
    kind: 'unique',
    slug,
    spec: {
      name: vm.name,
      typeLine: vm.className || vm.base,
      lines,
      accent: UNIQUE_ACCENT,
      glow: UNIQUE_GLOW,
      artPath: localArt(node.props?.iconDds),
    },
  };
}

function baseSpec(slug) {
  const vm = buildBaseItemViewModel(slug);
  if (!vm) return null;
  const lines = [
    ...vm.properties.map((p) => (p.value ? `${p.label}: ${p.value}` : p.label)).filter(Boolean),
    ...(vm.implicits || []).flatMap((m) => plainLines(m.html || m.text)),
  ];
  return {
    kind: 'base',
    slug,
    spec: {
      name: vm.name,
      typeLine: vm.className,
      lines,
      accent: NORMAL_ACCENT,
      glow: 'rgba(200,200,200,0.22)',
      artPath: localArt(vm.iconUrl),
    },
  };
}

// All card targets across the supported kinds. Each is { kind, slug, spec }.
export function collectOgTargets() {
  const out = [];
  for (const n of nodesByKind('gem')) out.push(gemSpec(n.slug));
  for (const n of nodesByKind('unique')) out.push(uniqueSpec(n.slug, n));
  for (const n of nodesByKind('base')) out.push(baseSpec(n.slug));
  return out.filter(Boolean);
}
