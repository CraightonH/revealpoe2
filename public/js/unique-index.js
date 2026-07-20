import { initItemIndex } from '/static/js/item-index.js';

initItemIndex({
  rootSelector: '.unique-index',
  rowSelector: '.item-index-row[data-item-slug]',
  slugDataKey: 'itemSlug',
  nameDataKey: 'itemName',
  detailContentSelector: '.item-detail',
  detailPathPrefix: '/unique/',
  searchIndexCategories: ['unique'],
  noun: 'unique item',
  plural: 'unique items',
  crossIndexRoutes: [{ detailPathPrefix: '/base/', indexPath: '/bases' }],
});
