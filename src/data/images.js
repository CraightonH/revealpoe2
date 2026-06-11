const GGPK = 'https://image.ggpk.exposed/poe2';

// Convert an in-game dds asset path to a renderable ggpk webp URL.
export function ddsUrl(ddsPath, format = 'webp') {
  if (!ddsPath) return null;
  return `${GGPK}/${ddsPath}?format=${format}`;
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
