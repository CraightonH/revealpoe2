// src/mcp/contract.js — the single tool registry. Worker + tests iterate this.
// inputSchema values are zod RAW SHAPES ({name: z.string()}), as registerTool wants.
import { z } from 'zod';
import { schema } from './tools/schema.js';
import { find, explain } from './tools/find.js';
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
];
