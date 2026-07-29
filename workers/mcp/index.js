// workers/mcp/index.js — the ONLY Cloudflare-aware file. Auth first, then the
// stateless MCP handler; tools come from the shared contract and run against
// the D1 backend. This file must never import backends/fs.js.
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { createD1Backend } from '../../src/mcp/backends/d1.js';
import { TOOLS } from '../../src/mcp/contract.js';
import { authorized } from '../../src/mcp/auth.js';

function makeServer(env) {
  const backend = createD1Backend(env.DB);
  const server = new McpServer({ name: 'revealpoe2-graph', version: '1.0.0' });
  for (const t of TOOLS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema },
      async (args) => {
        const result = await t.handler(backend, args ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: Boolean(result?.error) };
      });
  }
  return server;
}

export default {
  async fetch(request, env, ctx) {
    if (!authorized(request.headers.get('authorization'), env.MCP_TOKEN)) {
      return new Response('unauthorized', { status: 401 }); // no tool list for the unauthenticated
    }
    return createMcpHandler(() => makeServer(env))(request, env, ctx);
  },
};
