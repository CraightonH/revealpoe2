// src/mcp/tools/schema.js
export async function schema(backend) {
  const [info, meta, tm] = await Promise.all([backend.schemaInfo(), backend.meta(), backend.treeMeta()]);
  return {
    kinds: info.kinds,
    relations: info.relations,
    budgets: { passivePoints: tm.pointBudget, ascendancyPoints: tm.ascendancyBudget },
    data: meta,
  };
}
