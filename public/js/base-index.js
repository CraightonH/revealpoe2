import { initItemIndex } from '/static/js/item-index.js';

initItemIndex({
  rootSelector: '.base-index',
  rowSelector: '.item-index-row[data-item-slug]',
  slugDataKey: 'itemSlug',
  nameDataKey: 'itemName',
  detailContentSelector: '.base-class-detail',
  detailPathPrefix: '/bases/',
  searchIndexCategories: ['base'],
  searchResultSlugDataKey: 'searchSlugs',
  searchRowTextDataKey: 'searchText',
  selectFirstSearchMatch: true,
  noun: 'item class',
  plural: 'item classes',
  widgetInitializers: ['initFilterBars'],
  crossIndexRoutes: [
    { detailPathPrefix: '/unique/', indexPath: '/uniques' },
    { detailPathPrefix: '/gem/', indexPath: '/gems' },
  ],
});
