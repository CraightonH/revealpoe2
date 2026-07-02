// OG card renderer: turns a plain card spec into a 1200x630 PNG suitable for
// an og:image. Built at deploy time (see scripts/build-og.js) so production
// stays a dependency-free static upload — Discord/iMessage/Slack/Twitter read
// the resulting PNG via the page's <meta property="og:image">.
//
// Pipeline: satori (HTML/flexbox -> SVG) -> resvg (SVG -> PNG). Item art is a
// webp on disk (public/img, mirrored from ggpk); sharp decodes it to a PNG data
// URI because resvg can't rasterize webp. Art is best-effort: a decode failure
// degrades to a text-only card rather than failing the build, mirroring the
// site's placeholder-icon philosophy.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Standard "summary_large_image" dimensions. Scrapers letterbox other ratios.
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// Fonts are loaded once and shared across every card. OptimusPrinceps is the
// in-game title face; Fontin is the body face — both already shipped for the
// live site (public/fonts), so the cards match the page typography.
const FONTS = [
  { name: 'Optimus', weight: 700, style: 'normal', file: 'OptimusPrincepsSemiBold.ttf' },
  { name: 'Fontin', weight: 400, style: 'normal', file: 'fontin-regular-webfont.woff' },
].map((f) => ({ ...f, data: fs.readFileSync(path.join(root, 'public', 'fonts', f.file)) }));

// Decode a local webp to a base64 PNG data URI (resvg embeds it). Returns null
// on any failure so the card renders text-only instead of breaking the build.
async function artDataUri(localPath) {
  if (!localPath) return null;
  try {
    const png = await sharp(fs.readFileSync(localPath))
      .resize(400, 400, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

const div = (style, children) => ({ type: 'div', props: { style, children } });

// Build the satori element tree for one card.
function tree({ name, typeLine, lines, accent, glow, artUri }) {
  const textCol = div(
    { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
    [
      div(
        {
          fontFamily: 'Optimus',
          fontSize: name.length > 22 ? '60px' : '76px',
          lineHeight: 1.05,
          color: accent,
          letterSpacing: '1px',
        },
        name,
      ),
      typeLine
        ? div({ fontFamily: 'Fontin', fontSize: '34px', color: '#c9aa71', marginTop: '10px' }, typeLine)
        : null,
      div(
        { display: 'flex', flexDirection: 'column', marginTop: '26px', gap: '10px' },
        lines.map((l) =>
          div({ fontFamily: 'Fontin', fontSize: '30px', color: '#8aa3ff', lineHeight: 1.15 }, l),
        ),
      ),
    ].filter(Boolean),
  );

  const artBox = artUri
    ? div(
        {
          display: 'flex',
          width: '300px',
          height: '300px',
          marginLeft: '48px',
          alignItems: 'center',
          justifyContent: 'center',
          // Faint accent glow behind the art, echoing the in-game card.
          background: `radial-gradient(circle at center, ${glow} 0%, rgba(0,0,0,0) 70%)`,
        },
        [{ type: 'img', props: { src: artUri, style: { maxWidth: '280px', maxHeight: '280px' } } }],
      )
    : null;

  return div(
    {
      width: `${OG_WIDTH}px`,
      height: `${OG_HEIGHT}px`,
      display: 'flex',
      flexDirection: 'column',
      background: '#0c0c0f',
      // Accent border frames the card in the item's rarity color.
      borderTop: `8px solid ${accent}`,
      padding: '64px 72px',
      position: 'relative',
    },
    [
      div({ display: 'flex', flex: 1, alignItems: 'center' }, [textCol, artBox].filter(Boolean)),
      // Footer brand strip.
      div(
        { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' },
        [
          div({ fontFamily: 'Optimus', fontSize: '32px', color: '#e6c989', letterSpacing: '2px' }, 'Reveal'),
          div({ fontFamily: 'Fontin', fontSize: '24px', color: '#6b6b6b' }, 'revealpoe2.com'),
        ],
      ),
    ],
  );
}

// Render a card spec to a PNG Buffer.
export async function renderCard(spec) {
  const artUri = await artDataUri(spec.artPath);
  const svg = await satori(
    tree({
      name: spec.name,
      typeLine: spec.typeLine || '',
      lines: (spec.lines || []).slice(0, 5),
      accent: spec.accent || '#c8c8c8',
      glow: spec.glow || 'rgba(200,200,200,0.25)',
      artUri,
    }),
    { width: OG_WIDTH, height: OG_HEIGHT, fonts: FONTS },
  );
  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}
