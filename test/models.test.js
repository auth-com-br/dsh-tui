import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { modelsFlow, keyProblem, routeProblem, keyRefFor, providerRow } from '../src/models.js';

/**
 * /models. If these regress, a key is stored with junk pasted around it, a
 * server is added under a name dsh refuses or without the key pi-ai needs,
 * or a provider is removed without being asked.
 */

/** A scripted person: each ask gets the next answer list. */
function person(...replies) {
  const asked = [];
  const said = [];
  return {
    asked,
    said,
    io: {
      ask: async questions => {
        asked.push(questions);
        return replies.shift();
      },
      say: text => said.push(text),
    },
  };
}

function services(providers, discovered = [{ id: 'qwen' }]) {
  const calls = [];
  return {
    calls,
    svc: {
      providers: async () => providers,
      setKey: async (ref, value) => calls.push(['setKey', ref, value]),
      unsetKey: async ref => calls.push(['unsetKey', ref]),
      discover: async req => {
        calls.push(['discover', req]);
        if (discovered instanceof Error) {
          throw discovered;
        }
        return discovered;
      },
      setRoute: async (route, profile) => calls.push(['setRoute', route, profile]),
      setModels: async (route, models) => calls.push(['setModels', route, models]),
      removeRoute: async route => calls.push(['removeRoute', route]),
    },
  };
}

const deepseek = {
  id: 'deepseek-official',
  name: 'DeepSeek',
  keyRef: 'DEEPSEEK_API_KEY',
  keySet: false,
  keyWritable: true,
  models: ['deepseek-chat'],
};
const bonsai = {
  id: 'bonsai',
  name: 'Bonsai',
  keyRef: 'BONSAI_API_KEY',
  keySet: true,
  keyWritable: true,
  models: ['qwen'],
  route: 'bonsai',
  baseURL: 'http://h:8081/v1',
  api: 'openai-completions',
};
const pick = (id, label) => [{ id, selected: [label] }];
const type = (id, text) => ({ id, selected: [], custom: text });

describe('checks', () => {
  test('a key pasted with its name or quotes, or blank, is refused', () => {
    assert.equal(keyProblem('sk-abc'), undefined);
    assert.match(keyProblem('DEEPSEEK_API_KEY=sk-abc'), /without NAME=/);
    assert.match(keyProblem('"sk-abc"'), /without NAME=/);
    assert.match(keyProblem('   '), /blank/);
    assert.match(keyProblem('sk abc'), /characters/);
  });

  test('a route is a lowercase name not taken, with an http URL', () => {
    assert.equal(routeProblem('office-gpu', 'http://h/v1', []), undefined);
    assert.match(routeProblem('Office', 'http://h/v1', []), /not a route name/);
    assert.match(routeProblem('bonsai', 'http://h/v1', ['bonsai']), /already/);
    assert.match(routeProblem('x', 'h:8081', []), /not an http/);
    assert.equal(keyRefFor('office-gpu'), 'OFFICE_GPU_API_KEY');
  });

  test('a row says whether the key is set and how many models', () => {
    assert.deepEqual(providerRow(bonsai), {
      label: 'Bonsai (bonsai)',
      description: '✓ key · 1 model · http://h:8081/v1',
    });
  });
});

describe('modelsFlow', () => {
  test('setting a key stores it under the provider reference', async () => {
    const p = person(
      pick('provider', 'DeepSeek (deepseek-official)'),
      pick('action', 'set the API key'),
      [type('key', ' sk-123 ')],
    );
    const s = services([deepseek]);
    await modelsFlow(p.io, s.svc);
    assert.deepEqual(s.calls, [['setKey', 'DEEPSEEK_API_KEY', 'sk-123']]);
    assert.equal(p.asked[2][0].secret, true);
  });

  test('a server is added with the models it lists and a key, a placeholder when it needs none', async () => {
    const p = person(
      pick('provider', '+ add a server (OpenAI-compatible: a local model server, a gateway)'),
      [
        type('route', 'office-gpu'),
        type('url', 'http://10.0.0.5:8000/v1/'),
        { id: 'key', selected: [] },
      ],
    );
    const s = services([bonsai], [{ id: 'llama', contextWindow: 8192 }]);
    await modelsFlow(p.io, s.svc);
    assert.deepEqual(s.calls, [
      [
        'discover',
        { baseURL: 'http://10.0.0.5:8000/v1', api: 'openai-completions', apiKey: 'local' },
      ],
      [
        'setRoute',
        'office-gpu',
        {
          api: 'openai-completions',
          apiKeyEnv: 'OFFICE_GPU_API_KEY',
          baseURL: 'http://10.0.0.5:8000/v1',
          models: [{ id: 'llama', contextWindow: 8192 }],
        },
      ],
      ['setKey', 'OFFICE_GPU_API_KEY', 'local'],
    ]);
    assert.match(p.said.at(-1), /added office-gpu/);
  });

  test('a server that cannot be asked for its models takes one typed in', async () => {
    const p = person(
      pick('provider', '+ add a server (OpenAI-compatible: a local model server, a gateway)'),
      [type('route', 'gw'), type('url', 'https://gw.example/v1'), type('key', 'sk-1')],
      [type('model', 'big-model')],
    );
    const s = services([], new Error('401'));
    await modelsFlow(p.io, s.svc);
    assert.deepEqual(s.calls.at(-2), [
      'setRoute',
      'gw',
      {
        api: 'openai-completions',
        apiKeyEnv: 'GW_API_KEY',
        baseURL: 'https://gw.example/v1',
        models: [{ id: 'big-model' }],
      },
    ]);
    assert.deepEqual(s.calls.at(-1), ['setKey', 'GW_API_KEY', 'sk-1']);
    assert.match(p.said[0], /could not list.*401/);
  });

  test('a taken name is refused before anything is written', async () => {
    const p = person(
      pick('provider', '+ add a server (OpenAI-compatible: a local model server, a gateway)'),
      [type('route', 'bonsai'), type('url', 'http://h/v1'), { id: 'key', selected: [] }],
    );
    const s = services([bonsai]);
    await modelsFlow(p.io, s.svc);
    assert.deepEqual(s.calls, []);
    assert.match(p.said[0], /already/);
  });

  test('a server route is removed only when the person says yes, with the key named after it', async () => {
    const no = person(
      pick('provider', 'Bonsai (bonsai)'),
      pick('action', 'remove this provider'),
      pick('sure', 'no, keep it'),
    );
    const s1 = services([bonsai]);
    await modelsFlow(no.io, s1.svc);
    assert.deepEqual(s1.calls, []);
    const yes = person(
      pick('provider', 'Bonsai (bonsai)'),
      pick('action', 'remove this provider'),
      pick('sure', 'yes, remove bonsai'),
    );
    const s2 = services([bonsai]);
    await modelsFlow(yes.io, s2.svc);
    assert.deepEqual(s2.calls, [
      ['removeRoute', 'bonsai'],
      ['unsetKey', 'BONSAI_API_KEY'],
    ]);
    const shared = person(
      pick('provider', 'Bonsai (bonsai)'),
      pick('action', 'remove this provider'),
      pick('sure', 'yes, remove bonsai'),
    );
    const s3 = services([{ ...bonsai, keyRef: 'SHARED_KEY' }]);
    await modelsFlow(shared.io, s3.svc);
    assert.deepEqual(
      s3.calls,
      [['removeRoute', 'bonsai']],
      'a key under another name may serve other routes',
    );
  });

  test("updating a server's models offers the ones it lists and keeps the marked", async () => {
    const p = person(
      pick('provider', 'Bonsai (bonsai)'),
      pick('action', 'update the models from the server'),
      [{ id: 'models', selected: ['b'] }],
    );
    const s = services([bonsai], [{ id: 'a' }, { id: 'b', maxTokens: 4096 }]);
    await modelsFlow(p.io, s.svc);
    assert.deepEqual(s.calls.at(-1), ['setModels', 'bonsai', [{ id: 'b', maxTokens: 4096 }]]);
  });

  test('a provider whose key is not dsh’s to change says so', async () => {
    const p = person(pick('provider', 'DeepSeek (deepseek-official)'));
    const s = services([{ ...deepseek, keyWritable: false }]);
    await modelsFlow(p.io, s.svc);
    assert.match(p.said[0], /nothing here can be changed/);
  });
});
