import { allDocs } from './theorycraft.js';
import { toSearchDocs, searchRank } from '../../public/js/query-core.js';

// The global dropdown is backed by Theory Crafting's full-text document set
// (names + stat lines + tags + flavour), so a query like "life regeneration"
// surfaces gems/uniques by effect, not just by name. The ranking/projection
// logic lives in the browser-shared query core (toSearchDocs + searchRank) so
// the client dropdown can't diverge from the server.

let _docs = null;
function docs() {
  return _docs ?? (_docs = toSearchDocs(allDocs()));
}

export function search(q, limit = 20) {
  return searchRank(docs(), q, limit);
}
