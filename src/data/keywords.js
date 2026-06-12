export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Convert "[Id]" / "[Id|Display]" tokens to styled spans; escape the rest.
// hasDefinition(id) gates interactivity: tokens it rejects render as plain
// escaped text (no span). Defaults to always-true so existing callers and
// unit tests are unaffected.
export function renderGameText(text, hasDefinition = () => true) {
  if (text == null) return '';
  let out = '';
  let last = 0;
  const re = /\[([^\]|]+)(?:\|([^\]]+))?\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    const id = m[1];
    const display = m[2] ?? m[1];
    if (hasDefinition(id)) {
      out += `<span class="kw" data-keyword="${escapeHtml(id)}">${escapeHtml(display)}</span>`;
    } else {
      out += escapeHtml(display);
    }
    last = re.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}
