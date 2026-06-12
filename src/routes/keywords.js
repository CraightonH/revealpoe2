import { getDefinition, hasDefinition } from '../data/keywordDefs.js';
import { renderGameText, escapeHtml } from '../data/keywords.js';

export function registerKeywords(app) {
  app.get('/api/keyword/:key', (req, res) => {
    const def = getDefinition(req.params.key);
    if (!def) return res.sendStatus(404);

    // Render nested [Key|Display] refs to gated .kw spans, then turn the
    // data's \r\n breaks into <br> (spans contain no newlines, so order is safe).
    const body = renderGameText(def.definition, hasDefinition).replace(/\r?\n/g, '<br>');

    res
      .set('Cache-Control', 'public, max-age=86400')
      .type('html')
      .send(
        `<div class="kw-tip"><strong>${escapeHtml(def.term)}</strong>` +
          `<div class="kw-tip__body">${body}</div></div>`
      );
  });
}
