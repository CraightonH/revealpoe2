import { initItemIndex } from '/static/js/item-index.js';

initItemIndex({
  rootSelector: '.gem-index',
  rowSelector: '.gem-index-row[data-gem-slug]',
  slugDataKey: 'gemSlug',
  nameDataKey: 'gemName',
  detailContentSelector: '.gem-detail',
  detailPathPrefix: '/gem/',
  indexPath: '/gems',
  searchIndexCategories: ['gem', 'support', 'spirit'],
  noun: 'gem',
  plural: 'gems',
  visibilityResetEvent: 'gem-index:visibility-reset',
  widgetInitializers: ['initGemLevelSelect', 'initGemQualityInput', 'initScalingToggle'],
});
