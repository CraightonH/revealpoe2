import { initItemIndex } from '/static/js/item-index.js';

initItemIndex({
  rootSelector: '.base-index',
  rowSelector: '.item-index-row[data-item-slug]',
  slugDataKey: 'itemSlug',
  nameDataKey: 'itemName',
  detailContentSelector: '.item-detail',
  detailPathPrefix: '/base/',
  searchIndexCategories: ['base'],
  noun: 'base item',
  plural: 'base items',
  crossIndexRoutes: [
    { detailPathPrefix: '/unique/', indexPath: '/uniques' },
    { detailPathPrefix: '/gem/', indexPath: '/gems' },
  ],
});
