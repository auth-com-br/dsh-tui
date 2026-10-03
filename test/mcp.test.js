import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { configuredServers, toolsByServer, mcpText } from '../src/mcp.js';

/**
 * /mcp. If these regress, a server that failed to connect looks the same
 * as one that works, or the servers a profile configures are not listed.
 */

const entry = (id, config, disabled) => ({
  options: { id, name: '@deepseek-ai/dsh-mcp-client', config, ...(disabled ? { disabled } : {}) },
});

// The shape the harness's loader has: groups whose tree store holds entries.
const tree = (...entries) => ({
  tree: {
    store: {
      include: {
        subgroup: {
          tree: { store: Object.fromEntries(entries.map(e => [e.options.id, e])) },
        },
      },
      other: { options: { id: 'x', name: 'deepseek-harness-tui' } },
    },
  },
});

describe('configuredServers', () => {
  test('finds the MCP entries in the loader tree, with their target', () => {
    const servers = configuredServers(
      tree(
        entry('mcp-c7', {
          serverName: 'context7',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'c7'],
        }),
        entry(
          'mcp-web',
          { serverName: 'web', transport: 'streamable-http', url: 'http://h/mcp' },
          true,
        ),
      ),
    );
    assert.deepEqual(servers, [
      {
        id: 'mcp-c7',
        server: 'context7',
        transport: 'stdio',
        target: 'npx -y c7',
        disabled: false,
      },
      {
        id: 'mcp-web',
        server: 'web',
        transport: 'streamable-http',
        target: 'http://h/mcp',
        disabled: true,
      },
    ]);
  });

  test('an unexpected tree is no servers, not a crash', () => {
    assert.deepEqual(configuredServers(undefined), []);
    assert.deepEqual(configuredServers({ tree: { store: 5 } }), []);
  });
});

describe('toolsByServer', () => {
  test('groups mcp__server__tool names and ignores the rest', () => {
    const got = toolsByServer([
      'read',
      'mcp__context7__query-docs',
      'mcp__context7__resolve',
      'mcp__a_b__x',
    ]);
    assert.deepEqual(
      [...got],
      [
        ['context7', ['query-docs', 'resolve']],
        ['a_b', ['x']],
      ],
    );
  });
});

describe('mcpText', () => {
  test('a server without tools is marked failed, a working one counts its tools', () => {
    const text = mcpText(
      [
        { id: 'a', server: 'context7', transport: 'stdio', target: 'npx c7', disabled: false },
        {
          id: 'b',
          server: 'down',
          transport: 'streamable-http',
          target: 'http://h',
          disabled: false,
        },
        { id: 'c', server: 'off', transport: 'stdio', target: 'x', disabled: true },
      ],
      new Map([['context7', ['query-docs', 'resolve']]]),
      'P',
    );
    assert.match(text, /context7\s+✓ 2 tools/);
    assert.match(text, /query-docs, resolve/);
    assert.match(text, /down\s+✗ no tools/);
    assert.match(text, /off\s+off/);
  });

  test('no servers says how to add one', () => {
    assert.match(mcpText([], new Map(), 'P'), /no MCP servers[\s\S]*dsh-mcp-client/);
  });
});
