// public/js/tree-panel.js
// Pure ES module — the passive-tree control panels (stats + controls) as one
// HTML string. Single source shared by /passives (Nunjucks host injects via
// init) and the client-rendered build editor, so the two never drift and can
// coexist on one page without id collisions (JS hooks are data-* + scoped).
export function treePanelsHtml() {
  return `
    <div class="tree-panel tree-stats-panel" data-tree-stats-panel>
      <button type="button" class="tree-panel-toggle" data-tree-stats-toggle
              aria-label="Collapse stats" title="Collapse">‹</button>
      <div class="tree-panel-body">
        <div class="tree-panel-points" data-tree-stats-points>Passive Stats</div>
        <div class="tree-stats-list" data-tree-stats-list>
          <p class="tree-stats-empty">Allocate nodes to see totals.</p>
        </div>
      </div>
    </div>
    <div class="tree-panel" data-tree-panel>
      <button type="button" class="tree-panel-toggle" data-tree-panel-toggle
              aria-label="Collapse panel" title="Collapse">›</button>
      <div class="tree-panel-body">
        <div class="tree-panel-points" data-tree-points></div>
        <div class="tree-panel-row tree-panel-ws"
             title="Allocate per-weapon-set passives — pick a set, then click nodes">
          <span class="tree-panel-label">Weapon Set</span>
          <div class="tree-ws-sets">
            <button type="button" class="tree-ws-btn" data-ws-set="1">I</button>
            <span class="tree-ws-count" data-ws-count="1">0 / 25</span>
            <button type="button" class="tree-ws-btn" data-ws-set="2">II</button>
            <span class="tree-ws-count" data-ws-count="2">0 / 25</span>
          </div>
        </div>
        <label class="tree-panel-field tree-field--class">
          <span class="tree-panel-label">Character Class</span>
          <select data-tree-class class="passive-tree-select"></select>
        </label>
        <label class="tree-panel-field tree-field--asc">
          <span class="tree-panel-label">Ascendancy</span>
          <select data-tree-asc class="passive-tree-select"></select>
        </label>
        <label class="tree-panel-field">
          <span class="tree-panel-label">Search</span>
          <input type="search" data-tree-search class="passive-tree-input"
                 placeholder="Name or stat…" autocomplete="off" spellcheck="false">
        </label>
        <div class="tree-panel-actions">
          <button type="button" data-tree-reset class="passive-tree-btn">Reset Tree</button>
          <button type="button" data-tree-copy class="passive-tree-btn">Copy Share Code</button>
          <button type="button" data-tree-fullscreen class="passive-tree-btn tree-fullscreen-btn">Fullscreen</button>
        </div>
      </div>
    </div>`;
}
