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
import { parseArgs, USAGE, listSessions } from './sessions.js';

/** Stable Cordis plugin name (bundle row id: tui-runner). */
export const name = 'tui-runner';

/** Core services required before the interactive session can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'sessionPersistence'];

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
  // The TUI's own command line, after `dsh --profile tui`: dsh-cmdline
  // provides it as a holder whose get() is the snapshot, as its own
  // parseCmdline reads it.
  const args = parseArgs(ctx.get('cmdlineArgs')?.get?.() ?? []);
  if (args.help || args.error) {
    (args.error ? console.error : console.log)(args.error ?? USAGE);
    exit(args.error ? 2 : 0);
    return;
  }

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
  const persistence = ctx.get('sessionPersistence');
  const cwd = process.cwd();

  // The session on screen. /sessions replaces it — the old agent's log is
  // flushed and the agent disposed, the chosen one resumed — so everything
  // below reads `current` rather than holding one agent.
  const current = {
    handle: undefined,
    agent: undefined,
    firstSeq: 0,
    selected: undefined,
    resumed: false,
  };

  /**
   * Open a session: a new one, or `resumeId`'s from disk (agents.resume, as
   * the ACP bridge resumes). Its model is the default selection, read by the
   * harness at each step (installModelSelection): /model switches it by
   * replacing `current`, which takes effect on the next step.
   * @param {string | undefined} resumeId
   */
  const open = async resumeId => {
    const selection = defaultModel.currentSelection();
    const selected = { current: selection, assembled: undefined };
    const options = {
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: agentCtx => {
        installModelSelection(agentCtx, selected);
      },
    };
    const handle =
      resumeId === undefined
        ? await agents.create({
            sessionId: SessionId(`session-${randomUUID()}`),
            meta: { cwd },
            ...options,
          })
        : await agents.resume({ resumeSessionId: SessionId(resumeId), ...options });
    await handle.agent.whenIdle();
    Object.assign(current, {
      handle,
      agent: handle.agent,
      selected,
      resumed: resumeId !== undefined,
      // Events below this seq are construction seed history, not chat — for
      // a resumed session, its whole past, replayed onto the screen.
      firstSeq: handle.agent.session.seq,
    });
  };

  let resumeId;
  if (args.resume === true) {
    const latest = persistence ? await listSessions(persistence, cwd, { limit: 1 }) : [];
    if (latest.length === 0) {
      console.error('dsh-tui: no session in this directory to resume');
    }
    resumeId = latest[0]?.id;
  } else if (typeof args.resume === 'string') {
    resumeId = args.resume;
  }
  await open(resumeId);

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
        .flush(current.agent.session)
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
    if (current.agent === undefined || session.id !== current.agent.session.id) {
      return;
    }
    if (event.seq >= current.firstSeq) {
      if (event.type === 'turn/end') {
        void sessions.flush(current.agent.session).catch(error => {
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

  let app;
  let exited = false;
  const onExit = () => {
    if (exited) {
      return;
    }
    exited = true;
    // Final durability checkpoint before the harness exits.
    void sessions.flush(current.agent.session).catch(() => {});
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
    if (request.agent !== current.agent || approvalHandler === undefined) {
      return next();
    }
    return approvalHandler(request);
  });

  // The answerer for the questions this agent asks the user
  // (dsh-user-questions: ask_user_question, and plan mode's review). With no
  // answerer the ask fails with NO_PROVIDER and the model is told the user
  // could not be asked.
  ctx.on('user-questions/request', (request, next) => {
    if (request.agent !== current.agent || questionHandler === undefined) {
      return next();
    }
    return questionHandler(request);
  });

  /**
   * Switch to another session: the one on screen is flushed and disposed,
   * the chosen one resumed and shown with its past. A session that cannot be
   * resumed leaves the old one where it was.
   * @param {string} id
   */
  const switchTo = async id => {
    const prev = { ...current };
    const old = current.handle;
    const oldAgent = current.agent;
    await sessions.flush(oldAgent.session).catch(() => {});
    try {
      await open(id);
    } catch (error) {
      Object.assign(current, prev);
      throw error;
    }
    app.unmount();
    await old.dispose().catch(() => {});
    mount();
  };

  // exitOnCtrlC: false — the App owns Ctrl-C so it can exit the harness cleanly.
  const mount = () => {
    const { agent, firstSeq, selected, resumed } = current;
    app = render(
      React.createElement(App, {
        key: agent.session.id,
        // A function, not the agent: React's development build walks a
        // component's props to log them, and the agent is a Cordis object
        // that throws on any property it was not given ("cannot get
        // property $$typeof without inject"), printed at every start.
        followup: message => agent.followup(message),
        onEvent: forward,
        onApproval,
        onQuestion,
        // The harness's slash commands (dsh-commands): /permission, /goal,
        // /compact and whatever else the profile composes. They run against
        // the agent and never become a model message; an unknown or
        // malformed line returns undefined.
        runCommand: line => {
          const commands = ctx.get('commands');
          if (commands === undefined) {
            return Promise.resolve(undefined);
          }
          return commands.execute(agent, line, [], new AbortController().signal);
        },
        listCommands: () => ctx.get('commands')?.list(agent) ?? [],
        // The skills the user can invoke here, for the `/` menu: what the
        // web app's skill source lists (skills/list), read from the skill
        // registry for this directory and agent.
        listSkills: async () => {
          const skills = ctx.get('skills');
          if (skills === undefined) {
            return [];
          }
          return (await skills.list({ cwd, scope: agent }))
            .filter(s => s.invocation?.userInvocable)
            .map(s => ({ name: s.name, description: s.description ?? '', kind: 'skill' }));
        },
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
        // /sessions: this directory's other sessions, and the switch.
        listSessions: () =>
          persistence
            ? listSessions(persistence, cwd, { skip: agent.session.id })
            : Promise.resolve([]),
        switchSession: switchTo,
        // A resumed session's past, replayed onto the screen; a new one has
        // only its construction seed, which is not chat.
        history: resumed ? agent.session.snapshotEvents(0, firstSeq) : [],
        firstSeq,
        model: selected.current?.model ?? '?',
        themeBg,
      }),
      { exitOnCtrlC: false },
    );
  };
  mount();
}
