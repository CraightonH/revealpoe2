export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The "[keyword|display]" / "[keyword]" markup grammar, shared by renderGameText
// (interactive spans) and stripGameText (plain text).
const GAME_TEXT_RE = /\[([^\]|]+)(?:\|([^\]]+))?\]/g;

// Curated surface-phrase → keyword-id map. The game data tokenizes glossary terms
// inconsistently (pob-uniques has none; stat translations tokenize some but not
// all), so we additionally detect known terms in plain text and make them .kw
// glossary hovers. Longest phrases first so e.g. "Critical Hit" wins over "Hit"
// and "Evasion Rating" wins over "Evasion". Gated by hasDefinition at call time,
// so dead keywords render as plain text. Shared by renderGameText (gem/passive
// prose) and uniques' affix renderer so the SAME terms link everywhere.
export const KEYWORD_PHRASES = [
  ['Critical Strike', 'Critical'], ['Critical Hits', 'Critical'], ['Critical Hit', 'Critical'],
  ['Energy Shield', 'EnergyShield'], ['Spear Skills', 'Spear'],
  ['Evasion Rating', 'Evasion'], ['Evasion', 'Evasion'], ['Armour', 'Armour'],
  ['all Attributes', 'Attributes'], ['Attributes', 'Attributes'],
  ['Strength', 'Strength'], ['Dexterity', 'Dexterity'], ['Intelligence', 'Intelligence'],
  ['Physical', 'Physical'], ['Fire', 'Fire'], ['Cold', 'Cold'],
  ['Lightning', 'Lightning'], ['Chaos', 'Chaos'],
  ['Attacks', 'Attack'], ['Attack', 'Attack'], ['Presence', 'Presence'],
  ['Spells', 'Spell'], ['Spell', 'Spell'], ['Projectiles', 'Projectile'], ['Projectile', 'Projectile'],
  ['Minions', 'Minion'], ['Minion', 'Minion'], ['Melee', 'Melee'],
  ['Spears', 'Spear'], ['Spear', 'Spear'], ['Hit', 'HitDamage'],
  ['Ignite', 'Ignite'], ['Bleeding', 'Bleeding'], ['Poison', 'Poison'],
  ['Freeze', 'Freeze'], ['Shock', 'Shock'], ['Chill', 'Chill'],
  ['Block', 'Block'], ['Curses', 'Curse'], ['Curse', 'Curse'], ['Auras', 'Aura'], ['Aura', 'Aura'],
];

const PHRASE_TO_ID = new Map(KEYWORD_PHRASES.map(([p, id]) => [p, id]));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Numeric values in stat text — a bare number ("10", "1.5"), a negative, or a
// parenthesized range ("(100-150)"). Range separators allow hyphen / en / em
// dash since the sources differ (mods use "-", skill per-level ranges use "—",
// synthesized damage-conversion uses "–"). Highlighted white via .mod-value so
// values stand out from the mod-color prose — the treatment uniques pioneered,
// applied everywhere stat text is rendered (see highlightNumbers / linkifyPhrases).
const NUM_RE = /\(?-?\d+(?:\.\d+)?(?:[-–—]-?\d+(?:\.\d+)?)?\)?/g;

// Escape `text`, wrapping any numeric value in a white .mod-value span.
function highlightNumbers(text) {
  let out = '';
  let last = 0;
  let m;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    out += `<span class="mod-value">${escapeHtml(m[0])}</span>`;
    last = NUM_RE.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}
const PHRASE_RE = new RegExp(
  `\\b(${KEYWORD_PHRASES.map(([p]) => p).sort((a, b) => b.length - a.length).map(escapeRe).join('|')})\\b`,
  'g',
);

// Wrap any curated keyword phrase in a hoverable .kw span, and any numeric value
// in a white .mod-value span; all other text is escaped. hasDefinition(id) gates
// each keyword match: unknown/dead keywords render as plain text. This is the
// universal renderer for plain (untokenized) stat text — keyword phrases and
// number highlighting reach every consumer (mods, gems, passives, base items,
// uniques) through here. Keyword phrases never contain digits, so numbers only
// ever appear in the gaps between phrases.
export function linkifyPhrases(text, hasDefinition = () => true) {
  if (text == null) return '';
  let out = '';
  let last = 0;
  let m;
  PHRASE_RE.lastIndex = 0;
  while ((m = PHRASE_RE.exec(text)) !== null) {
    out += highlightNumbers(text.slice(last, m.index));
    const id = PHRASE_TO_ID.get(m[1]);
    if (id && hasDefinition(id)) {
      out += `<span class="kw" data-keyword="${escapeHtml(id)}">${escapeHtml(m[1])}</span>`;
    } else {
      out += escapeHtml(m[1]);
    }
    last = PHRASE_RE.lastIndex;
  }
  out += highlightNumbers(text.slice(last));
  return out;
}

// Attribute requirements render as abbreviations ("46 Str", "(4—157) Dex") rather
// than full words, so the phrase linker above never sees them. Link the standalone
// Str/Dex/Int tokens to their glossary keyword.
const ABBR_TO_ID = { Str: 'Strength', Dex: 'Dexterity', Int: 'Intelligence' };
const ABBR_RE = /\b(Str|Dex|Int)\b/g;

// Escape a requirement string and wrap any Str/Dex/Int abbreviation in a .kw span.
export function linkifyRequirement(text, hasDefinition = () => true) {
  if (text == null) return '';
  let out = '';
  let last = 0;
  let m;
  ABBR_RE.lastIndex = 0;
  while ((m = ABBR_RE.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    const id = ABBR_TO_ID[m[1]];
    if (hasDefinition(id)) {
      out += `<span class="kw" data-keyword="${id}">${m[1]}</span>`;
    } else {
      out += escapeHtml(m[1]);
    }
    last = ABBR_RE.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

// Strip "[Id]" / "[Id|Display]" tokens to plain display text (display name when
// present, else the id). Leaves all other text untouched (no HTML escaping).
export function stripGameText(text) {
  if (text == null) return '';
  return text.replace(GAME_TEXT_RE, (_, id, display) => display ?? id);
}

// Convert "[Id]" / "[Id|Display]" tokens to styled spans; the plain text between
// tokens is run through the surface-phrase linker so untokenized glossary terms
// (e.g. a bare "Strength" or "Fire") also become hovers. hasDefinition(id) gates
// interactivity for both tokens and phrases. Defaults to always-true so existing
// callers and unit tests are unaffected.
export function renderGameText(text, hasDefinition = () => true) {
  if (text == null) return '';
  let out = '';
  let last = 0;
  const re = new RegExp(GAME_TEXT_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    out += linkifyPhrases(text.slice(last, m.index), hasDefinition);
    const id = m[1];
    const display = m[2] ?? m[1];
    if (hasDefinition(id)) {
      out += `<span class="kw" data-keyword="${escapeHtml(id)}">${escapeHtml(display)}</span>`;
    } else {
      out += escapeHtml(display);
    }
    last = re.lastIndex;
  }
  out += linkifyPhrases(text.slice(last), hasDefinition);
  return out;
}
