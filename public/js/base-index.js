import { initItemIndex } from '/static/js/item-index.js';

initItemIndex({
  rootSelector: '.base-index',
  rowSelector: '.item-index-row[data-item-slug]',
  slugDataKey: 'itemSlug',
  nameDataKey: 'itemName',
  detailContentSelector: '.base-class-detail',
  detailPathPrefix: '/bases/',
  indexPath: '/bases',
  searchIndexCategories: ['base'],
  searchResultSlugDataKey: 'searchSlugs',
  searchRowTextDataKey: 'searchText',
  selectFirstSearchMatch: true,
  noun: 'item class',
  plural: 'item classes',
  widgetInitializers: ['initFilterBars'],
  detailResolver(row) {
    const url = new URL(row.getAttribute('href'), location.origin);
    const attr = new URLSearchParams(location.search).get('attr');
    if (attr) url.searchParams.set('attr', attr);
    return { url: `${url.pathname}${url.search}`, selector: '.base-class-detail' };
  },
});
