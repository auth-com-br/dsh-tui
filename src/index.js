/**
 * dsh-tui — interactive terminal chat for the DeepSeek Harness. Cordis bundle
 * plugin (package `dsh-tui`), composed over dsh-base + dsh-headless; the patch
 * disables the headless one-shot rows and inserts this runner. Drives the core
 * Agent exactly like the headless runner, but streams session events into an
 * Ink chat UI instead of printing a single answer.
 */

import { randomUUID } from 'node:crypto';
import React from 'react';
import { probeTerminalBg } from './theme.js';
import { render } from 'ink';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { App } from './ui.js';

/** Stable Cordis plugin name (bundle row id: tui-runner). */
export const name = 'tui-runner';

/** Core services required before the interactive session can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions'];

/**
 * Bridge between the Cordis event bus (non-React) and the Ink tree. The App
 * installs its event consumer by calling the `onEvent` prop with a function
 * once mounted; every matching `session/event` is then forwarded to it.
 * Events are dropped until the App mounts.
 */
let uiHandler = undefined;
function forward(eventOrHandler) {
  if (typeof eventOrHandler === 'function' || eventOrHandler == null) {
    uiHandler = typeof eventOrHandler === 'function' ? eventOrHandler : undefined;
    return;
  }
  if (typeof uiHandler === 'function') {
    uiHandler(eventOrHandler);
  }
}

/**
 * Bridge for approvals, as `forward` is for events: the App installs the
 * function that asks the user, and the harness's approval requests for this
 * TUI's agent are handed to it. Until the App mounts — or after it unmounts —
 * a request is passed on (`next()`), so the harness fails closed as it does
 * with no answerer at all.
 */
let approvalHandler = undefined;
function onApproval(handler) {
  approvalHandler = typeof handler === 'function' ? handler : undefined;
}

/** The same bridge for the questions the agent asks the user. */
let questionHandler = undefined;
function onQuestion(handler) {
  questionHandler = typeof handler === 'function' ? handler : undefined;
}

/**
 * Mount the interactive chat driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit.
 */
export function apply(ctx) {
  // appExit is an optional host value provided by the launcher — read it
  // through the global service store, never the property proxy.
  const exit = ctx.get('appExit');
  if (exit === undefined) {
    throw new Error('tui-runner: the launcher must provide ctx.appExit before the tree mounts');
  }
  void run(ctx, exit).catch(error => {
    console.error(`dsh-tui: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  });
}

/** Create the agent and run the chat until the user quits. */
async function run(ctx, exit) {
  // Probe the terminal background BEFORE Ink mounts: Ink's key parser would
  // otherwise read the OSC 11 response as keystrokes and type garbage.
  const themeBg = await probeTerminalBg();

  // Loader siblings mount concurrently; await the complete composition before
  // creating an Agent so its scoped tools are not half-composed.
  await ctx.get('loader')?.await();

  const agents = ctx.get('agents');
  const defaultModel = ctx.get('agentDefaultModel');
  const sessions = ctx.get('sessions');
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    return;
  }

  // Create the agent exactly like the headless runner does.
  const selection = defaultModel.currentSelection();
  // The agent's model, read by the harness at each step (installModelSelection):
  // /model switches it by replacing `current`, which takes effect on the next
  // step rather than splitting one in flight.
  const selected = { current: selection, assembled: undefined };
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: agentCtx => {
      installModelSelection(agentCtx, selected);
    },
  });
  await agent.whenIdle();
  // Events below this seq are construction seed history, not chat.
  const firstSeq = agent.session.seq;

  // Debounced durability flush while a turn is running: a long or stuck turn
  // must be inspectable on disk without waiting for turn/end. The immediate
  // turn/end flush below remains the boundary checkpoint.
  let flushTimer = undefined;
  let flushing = false;
  const scheduleFlush = () => {
    if (flushTimer !== undefined || flushing) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      flushing = true;
      sessions
        .flush(agent.session)
        .catch(error => {
          console.error(
            `dsh-tui: session flush failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => {
          flushing = false;
        });
    }, 5000);
  };

  // Live append feed: forward this session's events to the UI and persist the
  // log at each turn boundary (fire-and-forget; flush is caller-owned).
  ctx.on('session/event', (session, event) => {
    if (session.id !== agent.session.id) {
      return;
    }
    if (event.seq >= firstSeq) {
      if (event.type === 'turn/end') {
        void sessions.flush(agent.session).catch(error => {
          console.error(
            `dsh-tui: session flush failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      } else if (
        event.type === 'turn/start' ||
        event.type === 'tool/call' ||
        event.type === 'tool/result'
      ) {
        scheduleFlush();
      }
    }
    forward(event);
  });

  let app; // eslint-disable-line prefer-const
  let exited = false;
  const onExit = () => {
    if (exited) {
      return;
    }
    exited = true;
    // Final durability checkpoint before the harness exits.
    void sessions.flush(agent.session).catch(() => {});
    if (app) {
      try {
        app.unmount();
      } catch {
        // The App already unmounted itself via useApp().exit().
      }
    }
    // The launcher's graceful path only sets process.exitCode and relies on
    // the event loop draining; file watchers can keep it alive after the UI
    // unmounts, so watchdog the process to release the terminal promptly.
    exit(0);
    setTimeout(() => {
      try {
        process.exit(0);
      } catch {
        // The process already exited via the graceful path.
      }
    }, 2000);
  };

  // The answerer for this agent's approval requests (dsh-user-approval):
  // with a session policy of `ask`, an action outside the workspace or
  // needing more access is put to the composed answerers, and with none
  // the request fails closed — which, before this, left the terminal with
  // no way to allow anything ("no approval channel is available"). Requests
  // for other agents (subagents have their own) are passed on. The outcomes
  // the service accepts are allowed-once, rejected and cancelled.
  ctx.on('approval/request', (request, next) => {
    if (request.agent !== agent || approvalHandler === undefined) {
      return next();
    }
    return approvalHandler(request);
  });

  // The answerer for the questions this agent asks the user
  // (dsh-user-questions: ask_user_question, and plan mode's review). With no
  // answerer the ask fails with NO_PROVIDER and the model is told the user
  // could not be asked.
  ctx.on('user-questions/request', (request, next) => {
    if (request.agent !== agent || questionHandler === undefined) {
      return next();
    }
    return questionHandler(request);
  });

  // exitOnCtrlC: false — the App owns Ctrl-C so it can exit the harness cleanly.
  app = render(
    React.createElement(App, {
      agent,
      onEvent: forward,
      onApproval,
      onQuestion,
      // The harness's slash commands (dsh-commands): /permission, /goal,
      // /compact and whatever else the profile composes. They run against
      // the agent and never become a model message; an unknown or malformed
      // line returns undefined.
      runCommand: line => {
        const commands = ctx.get('commands');
        if (commands === undefined) {
          return Promise.resolve(undefined);
        }
        return commands.execute(agent, line, [], new AbortController().signal);
      },
      listCommands: () => ctx.get('commands')?.list(agent) ?? [],
      onExit,
      onInterrupt: () => agent.cancel({ kind: 'user' }),
      // /model: the models of every configured route, the current one, and
      // a switch that also becomes the default for later sessions, as the
      // web app's model selection saves it.
      listModels: async () => {
        const llm = ctx.get('llm');
        if (llm === undefined) {
          return [];
        }
        const out = [];
        for (const provider of llm.listProviders()) {
          try {
            for (const m of await llm.listModels(provider.id)) {
              out.push({
                provider: provider.id,
                providerName: provider.name,
                model: m.id,
                name: m.name,
              });
            }
          } catch {
            // A route that cannot list its models is left out, not fatal.
          }
        }
        return out;
      },
      currentModel: () => selected.current,
      selectModel: next => {
        selected.current = { provider: next.provider, model: next.model };
        void Promise.resolve(defaultModel.saveSelection?.(selected.current)).catch(() => {});
      },
      firstSeq,
      model: selection.model,
      themeBg,
    }),
    { exitOnCtrlC: false },
  );
}
