// Local, self-hosted image base. Game art is fetched at build time from
// ggpk.exposed into public/img/ (see scripts/fetch-images.js) and served
// same-origin, so the live site has no runtime dependency on a third-party CDN.
const IMG_BASE = '/static/img';

// Map an in-game .dds asset path to its self-hosted webp file path, mirroring
// the dds directory tree. Shared by the renderer (ddsUrl) and the build-time
// fetcher so the two can never disagree on where an image lives.
export function imageRelPath(ddsPath) {
  return `${ddsPath.replace(/\.dds$/i, '')}.webp`;
}

// Renderable URL for an in-game dds asset path.
export function ddsUrl(ddsPath) {
  if (!ddsPath) return null;
  return `${IMG_BASE}/${imageRelPath(ddsPath)}`;
}

const GEM_HUE = { r: 0, g: 120, b: 240, w: 0 };

// Deterministic placeholder descriptor — works with zero network.
export function placeholder(record) {
  const name = record?.name ?? record?.id ?? '?';
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const hue = GEM_HUE[record?.color] ?? 0;
  const sat = record?.color === 'w' ? 0 : 45;
  return { label: name, initials, hue, sat };
}
