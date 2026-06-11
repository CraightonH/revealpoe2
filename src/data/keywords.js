function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Convert "[Id]" / "[Id|Display]" tokens to styled spans; escape the rest.
export function renderGameText(text) {
  if (text == null) return '';
  let out = '';
  let last = 0;
  const re = /\[([^\]|]+)(?:\|([^\]]+))?\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    const id = m[1];
    const display = m[2] ?? m[1];
    out += `<span class="kw" data-keyword="${escapeHtml(id)}">${escapeHtml(display)}</span>`;
    last = re.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}
