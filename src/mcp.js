/**
 * The MCP servers of this harness, for `/mcp`. The harness connects them
 * itself (dsh-mcp-client, one plugin entry per server in one of the
 * patch layers — the machine's, ~/.dsh/cordis.patch.yml, or a profile's) and
 * their tools register as `mcp__<server>__<tool>`;
 * this only reads what is there: the servers the profile configures, and
 * the tools each one gave the agent.
 *
 * The web app has no MCP surface to port; this is the TUI's own.
 */

const MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client';

/**
 * The MCP server entries in the loader's plugin tree: the composed
 * configuration, with the entries a patch disabled. The tree is the
 * loader's own (Cordis); it is walked defensively and anything unexpected
 * is skipped.
 * @param {any} root the loader's root entry (ctx.get('loader').root)
 * @returns {Array<{id: string, server: string, transport: string, target: string, disabled: boolean}>}
 */
export function configuredServers(root) {
  const out = [];
  const seen = new WeakSet();
  const walk = (entry, depth) => {
    if (!entry || typeof entry !== 'object' || depth > 12 || seen.has(entry)) {
      return;
    }
    seen.add(entry);
    const o = entry.options;
    if (o && o.name === MCP_PLUGIN && o.config && typeof o.config.serverName === 'string') {
      const c = o.config;
      out.push({
        id: String(o.id ?? c.serverName),
        server: c.serverName,
        transport: c.transport ?? '?',
        target:
          c.transport === 'stdio' ? [c.command, ...(c.args ?? [])].join(' ') : String(c.url ?? ''),
        disabled: o.disabled === true,
      });
    }
    const store = entry.tree?.store ?? entry.store;
    if (store && typeof store === 'object') {
      for (const child of store instanceof Map ? store.values() : Object.values(store)) {
        walk(child, depth + 1);
      }
    }
    if (entry.subgroup) {
      walk(entry.subgroup, depth + 1);
    }
    if (entry.include) {
      walk(entry.include, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * The tools each server gave, from the names the agent sees.
 * @param {Iterable<string>} toolNames
 * @returns {Map<string, string[]>} server → tool names (without the prefix)
 */
export function toolsByServer(toolNames) {
  const out = new Map();
  for (const name of toolNames) {
    const m = /^mcp__(.+?)__(.+)$/.exec(name);
    if (m === null) {
      continue;
    }
    const list = out.get(m[1]) ?? [];
    list.push(m[2]);
    out.set(m[1], list);
  }
  return out;
}

/**
 * What `/mcp` says: each server, whether its tools are there, and how many.
 * A configured server with no tools failed to connect or is still trying —
 * the harness logs which.
 * @param {ReturnType<typeof configuredServers>} servers
 * @param {Map<string, string[]>} tools
 * @param {string} patchPath where servers are added
 */
export function mcpText(servers, tools, patchPath) {
  const rows = [];
  const named = new Set();
  for (const s of servers) {
    named.add(s.server);
    const got = tools.get(s.server) ?? [];
    const state = s.disabled ? 'off' : got.length > 0 ? `✓ ${got.length} tools` : '✗ no tools';
    rows.push(`  ${s.server.padEnd(18)} ${state.padEnd(12)} ${s.transport.padEnd(16)} ${s.target}`);
    if (got.length > 0) {
      rows.push(`  ${''.padEnd(18)} ${got.join(', ')}`);
    }
  }
  // Tools of a server the tree did not show (a bundle's, or a tree this
  // reader does not understand) are still listed.
  for (const [server, got] of tools) {
    if (!named.has(server)) {
      rows.push(`  ${server.padEnd(18)} ${`✓ ${got.length} tools`.padEnd(12)}`);
      rows.push(`  ${''.padEnd(18)} ${got.join(', ')}`);
    }
  }
  if (rows.length === 0) {
    return [
      'no MCP servers.',
      `add one in ${patchPath}, or with tend's MCP manager (prefix+M):`,
      '',
      '  - insert:',
      '      - id: mcp-context7',
      `        name: '${MCP_PLUGIN}'`,
      '        config:',
      '          serverName: context7',
      '          transport: stdio            # or streamable-http, with url:',
      '          command: npx',
      "          args: ['-y', '@upstash/context7-mcp']",
      '',
      'then restart dsh.',
    ].join('\n');
  }
  return [
    'MCP servers:',
    ...rows,
    '',
    `configured in ${patchPath} (every profile) or a profile's cordis.patch.yml;`,
    'a change takes effect when dsh restarts.',
  ].join('\n');
}
