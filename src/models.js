/**
 * /models: the model providers and their keys, edited in the terminal —
 * the web app's Models settings page (dsh-client-ui-settings-models) for
 * what `~/.dsh/settings.yaml` was edited by hand for. A provider's key is
 * written and never read back (the credential store, write-only); a server
 * of one's own — a local model server, a company's gateway — is a pi-ai
 * route, written the way the web app writes one: `llm-pi-ai.providers.<route>`
 * with its base URL, protocol and models, and its key under `<ROUTE>_API_KEY`.
 * The models are asked of the server itself (llm.discoverModels), as the
 * web app's "fetch models" does.
 *
 * The flow is written against two small interfaces so it can be tested
 * without the harness: `io` asks and tells, `svc` reads and writes.
 */

/** dsh-client-ui-settings-models' rule for a route id. */
export const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/;
const LEGAL_API_KEY = /^[\x21-\x7E]+$/;
/** pi-ai's protocol for an OpenAI-compatible server. */
export const OPENAI_COMPATIBLE = 'openai-completions';
/**
 * pi-ai refuses a request on a route with no key ("No API key for
 * provider"), and a local server usually wants none: such a route is given
 * this one, which the server ignores.
 */
export const NO_KEY = 'local';

/**
 * The credential reference the web app derives for a route.
 * @param {string} route
 */
export function keyRefFor(route) {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
}

/**
 * Why a typed key cannot be stored, or undefined when it can: the web
 * app's checks — not blank, not an `ENV=value` line or a quoted string
 * pasted whole, printable ASCII only.
 * @param {string} value
 */
export function keyProblem(value) {
  const v = value.trim();
  if (v === '') {
    return 'the key is blank';
  }
  if (ENV_LINE.test(v) || /^(["']).*\1$/s.test(v)) {
    return 'paste the key alone, without NAME= or quotes';
  }
  if (!LEGAL_API_KEY.test(v)) {
    return 'the key has characters a key does not';
  }
  return undefined;
}

/**
 * Why a route id or base URL cannot be used, or undefined.
 * @param {string} route
 * @param {string} baseURL
 * @param {readonly string[]} taken
 */
export function routeProblem(route, baseURL, taken) {
  if (!ROUTE_PATTERN.test(route)) {
    return `"${route}" is not a route name: lowercase letters, digits and -, starting with a letter`;
  }
  if (taken.includes(route)) {
    return `there is a provider called ${route} already`;
  }
  if (!/^https?:\/\/\S+$/.test(baseURL)) {
    return `"${baseURL}" is not an http(s) URL`;
  }
  return undefined;
}

/**
 * @typedef {{id: string, name: string, keyRef: string, keySet: boolean, keyWritable: boolean, models: string[], route?: string, baseURL?: string, api?: string}} Provider
 * route is set for the pi-ai routes the user declared, the ones /models can
 * remove and refresh.
 */

/**
 * A provider as a row of the menu.
 * @param {Provider} p
 */
export function providerRow(p) {
  const key = p.keySet ? '✓ key' : '✗ no key';
  const models = `${p.models.length} model${p.models.length === 1 ? '' : 's'}`;
  return {
    label: p.name === p.id ? p.id : `${p.name} (${p.id})`,
    description: [key, models, p.baseURL].filter(Boolean).join(' · '),
  };
}

const ADD = '+ add a server (OpenAI-compatible: a local model server, a gateway)';
const answerOf = (answers, id) => answers?.find(a => a.id === id);
const picked = (answers, id) => answerOf(answers, id)?.selected?.[0];
const typed = (answers, id) => answerOf(answers, id)?.custom?.trim() ?? '';

/**
 * Run /models once: pick a provider and do one thing to it, or add one.
 * @param {{ask: (questions: object[]) => Promise<Array<{id: string, selected: string[], custom?: string}> | undefined>, say: (text: string, error?: boolean) => void}} io
 * @param {{providers: () => Promise<Provider[]>, setKey: (ref: string, value: string) => Promise<void>, unsetKey: (ref: string) => Promise<void>, discover: (req: object) => Promise<Array<{id: string, name?: string, contextWindow?: number, maxTokens?: number}>>, setRoute: (route: string, profile: object) => Promise<void>, setModels: (route: string, models: object[]) => Promise<void>, removeRoute: (route: string) => Promise<void>}} svc
 */
export async function modelsFlow(io, svc) {
  const providers = await svc.providers();
  const rows = providers.map(providerRow);
  const answers = await io.ask([
    {
      id: 'provider',
      question: 'Model providers — pick one to change, or add a server',
      custom: false,
      options: [...rows, { label: ADD }],
    },
  ]);
  const choice = picked(answers, 'provider');
  if (choice === undefined) {
    return;
  }
  if (choice === ADD) {
    await addServer(io, svc, providers);
    return;
  }
  const p = providers[rows.findIndex(r => r.label === choice)];
  if (p !== undefined) {
    await changeProvider(io, svc, p);
  }
}

async function changeProvider(io, svc, p) {
  const SET = p.keySet ? 'replace the API key' : 'set the API key';
  const UNSET = 'remove the API key';
  const REFRESH = 'update the models from the server';
  const REMOVE = 'remove this provider';
  const options = [
    ...(p.keyWritable ? [{ label: SET }] : []),
    ...(p.keySet && p.keyWritable ? [{ label: UNSET }] : []),
    ...(p.route !== undefined && p.baseURL ? [{ label: REFRESH }] : []),
    ...(p.route !== undefined ? [{ label: REMOVE }] : []),
  ];
  if (options.length === 0) {
    io.say(
      `${p.name}: nothing here can be changed from the terminal (its key is set outside dsh).`,
    );
    return;
  }
  const action = picked(
    await io.ask([
      {
        id: 'action',
        question: `${p.name} — ${providerRow(p).description}`,
        custom: false,
        options,
      },
    ]),
    'action',
  );
  if (action === SET) {
    const key = typed(
      await io.ask([
        { id: 'key', question: `API key for ${p.name} (stored, never shown again)`, secret: true },
      ]),
      'key',
    );
    if (key === '') {
      return;
    }
    const problem = keyProblem(key);
    if (problem !== undefined) {
      io.say(`✗ ${problem}`, true);
      return;
    }
    await svc.setKey(p.keyRef, key);
    io.say(`key for ${p.name} saved (${p.keyRef}); it is used from the next request.`);
  } else if (action === UNSET) {
    await svc.unsetKey(p.keyRef);
    io.say(`key for ${p.name} removed.`);
  } else if (action === REFRESH) {
    const models = await discover(io, svc, { baseURL: p.baseURL, api: p.api ?? OPENAI_COMPATIBLE });
    if (models === undefined) {
      return;
    }
    const chosen = await chooseModels(io, models, p.models);
    if (chosen === undefined) {
      return;
    }
    await svc.setModels(p.route, chosen);
    io.say(
      `${p.name}: ${chosen.length} model${chosen.length === 1 ? '' : 's'} — /model to pick one.`,
    );
  } else if (action === REMOVE) {
    const ownKey = p.keyRef === keyRefFor(p.route);
    const sure = picked(
      await io.ask([
        {
          id: 'sure',
          question: `Remove ${p.name}? Its models leave /model${ownKey ? ' and its key is deleted' : ''}.`,
          custom: false,
          options: [{ label: 'no, keep it' }, { label: `yes, remove ${p.id}` }],
        },
      ]),
      'sure',
    );
    if (sure?.startsWith('yes')) {
      await svc.removeRoute(p.route);
      // The key named after the route was the route's alone; one under
      // another name may serve other routes too, and stays.
      if (ownKey && p.keySet) {
        await svc.unsetKey(p.keyRef);
      }
      io.say(`${p.name} removed.`);
    }
  }
}

async function addServer(io, svc, providers) {
  const answers = await io.ask([
    { id: 'route', question: 'A short name for the server (lowercase, e.g. office-gpu)' },
    { id: 'url', question: 'Its base URL (e.g. http://192.168.1.18:8081/v1)' },
    {
      id: 'key',
      question: 'Its API key — esc if it needs none (a local server)',
      secret: true,
    },
  ]);
  if (answers === undefined) {
    return;
  }
  const route = typed(answers, 'route');
  const baseURL = typed(answers, 'url').replace(/\/+$/, '');
  const key = typed(answers, 'key');
  if (route === '' || baseURL === '') {
    return;
  }
  const problem =
    routeProblem(
      route,
      baseURL,
      providers.map(p => p.id),
    ) ?? (key === '' ? undefined : keyProblem(key));
  if (problem !== undefined) {
    io.say(`✗ ${problem}`, true);
    return;
  }
  const models = await discover(io, svc, {
    baseURL,
    api: OPENAI_COMPATIBLE,
    apiKey: key === '' ? NO_KEY : key,
  });
  if (models === undefined) {
    return;
  }
  const chosen = await chooseModels(io, models, []);
  if (chosen === undefined) {
    return;
  }
  const keyRef = keyRefFor(route);
  await svc.setRoute(route, { api: OPENAI_COMPATIBLE, apiKeyEnv: keyRef, baseURL, models: chosen });
  await svc.setKey(keyRef, key === '' ? NO_KEY : key);
  io.say(
    `added ${route} (${baseURL}) with ${chosen.length} model${chosen.length === 1 ? '' : 's'} — /model to use it.`,
  );
}

/**
 * The models a server says it has, or a model typed in when it says none
 * or cannot be asked; undefined when the person gave up.
 */
async function discover(io, svc, request) {
  try {
    const found = await svc.discover(request);
    if (found.length > 0) {
      return found;
    }
    io.say('the server listed no models.');
  } catch (error) {
    io.say(
      `could not list the server's models: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
  const id = typed(
    await io.ask([{ id: 'model', question: 'The model id to use on it (esc to give up)' }]),
    'model',
  );
  return id === '' ? undefined : [{ id }];
}

/** The models to keep, as profile entries; all of them when there is one. */
async function chooseModels(io, models, current) {
  if (models.length === 1) {
    return [modelEntry(models[0])];
  }
  const answers = await io.ask([
    {
      id: 'models',
      question: `${models.length} models — space marks, enter keeps the marked (or the one under the cursor)`,
      multiSelect: true,
      custom: false,
      options: models.map(m => ({
        label: m.id,
        description: [
          current.includes(m.id) ? 'in use' : '',
          m.contextWindow ? `${m.contextWindow} ctx` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    },
  ]);
  const ids = answerOf(answers, 'models')?.selected ?? [];
  if (ids.length === 0) {
    return undefined;
  }
  return models.filter(m => ids.includes(m.id)).map(modelEntry);
}

function modelEntry(m) {
  return {
    id: m.id,
    ...(m.name ? { name: m.name } : {}),
    ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
    ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
  };
}
