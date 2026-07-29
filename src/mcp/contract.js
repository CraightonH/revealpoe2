// src/mcp/contract.js — the single tool registry. Worker + tests iterate this.
// inputSchema values are zod RAW SHAPES ({name: z.string()}), as registerTool wants.
import { z } from 'zod';
import { schema } from './tools/schema.js';
import { find, explain } from './tools/find.js';
import { gem, item, affix, slot, ascendancy, passives } from './tools/entities.js';
import { traverse } from './tools/traverse.js';
import { buildLink } from './tools/build-link.js';
import { KINDS } from './kinds.js';

const limit = z.number().int().min(1).max(100).optional();

export const TOOLS = [
  {
    name: 'schema',
    description: 'The graph vocabulary: 12 node kinds, 11 relations with their endpoint kinds and counts, passive-point budgets, and data-freshness hashes. Call once and cache — it teaches you everything traverse() can chain.',
    inputSchema: {},
    handler: schema,
  },
  {
    name: 'find',
    description: 'Full-text entry point over names and stat text. Returns {kind, slug, name} refs — feed them to the entity tools or traverse().',
    inputSchema: { description: z.string().min(2), kind: z.enum(KINDS).optional(), limit },
    handler: find,
  },
  {
    name: 'explain',
    description: 'Glossary lookup for a game term (720 keywords) — definition and the phrases that reference it.',
    inputSchema: { term: z.string().min(2) },
    handler: explain,
  },
  { name: 'gem', description: 'Everything about a skill/support gem: what it grants, recommended supports, and what grants it.', inputSchema: { name: z.string().min(2) }, handler: gem },
  { name: 'item', description: 'A base, unique, or augment: slots, tags, implicits, affix pool summary, uniques on the base, granted skills, pool relationships.', inputSchema: { name: z.string().min(2), list: z.boolean().optional() }, handler: item },
  { name: 'affix', description: 'A mod: tier ranges and which bases it rolls on (summarized by item class; list: true to enumerate).', inputSchema: { name: z.string().min(2), list: z.boolean().optional() }, handler: affix },
  { name: 'slot', description: 'A gear slot: what it accepts, grouped by item class.', inputSchema: { name: z.string().min(2) }, handler: slot },
  { name: 'ascendancy', description: 'An ascendancy: its class and passives with tree hashes + stat lines.', inputSchema: { name: z.string().min(2) }, handler: ascendancy },
  { name: 'passives', description: 'Search passive tree nodes by name or intent; returns tree hashes usable in build_link notables.', inputSchema: { query: z.string().min(2), limit }, handler: passives },
  { name: 'traverse', description: 'Typed multi-hop graph walk for questions no semantic tool covers. Compose hops from schema() relations; results are refs only, capped. Example: unique --has_base(out)--> base <--rolls_on(in)-- affixes.', inputSchema: { start: z.object({ kind: z.enum(KINDS), slug: z.string() }), hops: z.array(z.object({ relation: z.string(), direction: z.enum(['out', 'in']) })).min(1).max(4), limit }, handler: traverse },
  {
    name: 'build_link',
    description: 'Assemble a Build Planner link. You supply the judgment (class, gems, notables by name or hash from passives()); the server resolves names (refusing on ambiguity), BFS-allocates a connected passive tree, validates, and returns a revealpoe2.com URL. variants: full sibling builds in the same URL, inheriting unset fields from the parent.',
    inputSchema: {
      name: z.string().max(60).optional(),
      class: z.string(),
      ascendancy: z.string().optional(),
      skills: z.array(z.object({
        gem: z.string(),
        level: z.number().int().min(1).max(40).optional(),
        supports: z.array(z.string()).max(8).optional(),
      })).max(24).optional(),
      gear: z.record(z.string(), z.object({
        item: z.string(),
        mods: z.array(z.string()).max(8).optional(),
      })).optional(),
      notables: z.array(z.union([z.string(), z.number().int()])).max(60).optional(),
      notes: z.string().max(10000).optional(),
      description: z.string().max(1000).optional(),
      variants: z.array(z.object({ label: z.string().max(40) }).passthrough()).max(12).optional(),
    },
    handler: (backend, args) => buildLink(backend, args),
  },
];
