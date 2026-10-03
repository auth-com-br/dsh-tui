# Roadmap — a complete terminal interface for the DeepSeek Harness

The DeepSeek Harness (`dsh`) ships a web interface: 37 `dsh-client-ui-*`
packages over the harness's services. This project is its terminal
counterpart, built the same way — a plugin inside the harness (Ink), with the
same services the web app uses — so that everything the web app does can be
done in a terminal, and inside tend.

It started from [gxinxing/deepseek-harness-tui](https://github.com/gxinxing/deepseek-harness-tui)
(MIT), which covers the conversation itself. The name is provisional; the
brand is decided last.

Each phase is usable on its own. Order is by what blocks real work first.

## Done

- Chat with markdown, tool calls folded into cells, foldable thinking, a
  `Working` status row, the todo panel, `/help` `/clear` `/exit`, `esc` to
  interrupt, scrolling. (upstream)
- A message taller than the screen is shown instead of leaving the screen
  blank. (here: `fix(viewport)`)
- Runs on a local, OpenAI-compatible model server through `dsh-llm-pi-ai`
  (`~/.dsh/settings.yaml`), for a client with their own AI server.

## Phase 1 — able to work (blocks real use)

- [x] **Approvals** (`dsh-client-ui-approval`). The sessions run with
      `approval/policy: ask`, and with no approval surface the harness fails
      closed: anything outside the workspace or needing more access is
      impossible ("no approval channel is available"). A prompt in place of
      the composer: what the agent wants to do, allow once / always / deny.
- [x] **Questions from the agent** (`dsh-client-ui-user-questions`): the
      agent asks, the composer becomes the answer.
- [x] **Permission presets** (`dsh-client-ui-permission-presets`):
      `/permission` to switch the session's (read-only, workspace-write,
      full access), and the default for new sessions.
- [x] **Model selection** (`dsh-client-ui-model-selection`): `/model` lists
      the configured routes and models — the local server among them — and
      switches the session's; the footer shows it.

## Phase 2 — sessions and context

- [x] **Sessions** (`session`, `workspace`, `sidebar`): `/sessions` lists
      this directory's and resumes one with its history; `--resume <id>`
      and `-c` from the command line (tend's "continue in…"); `/rename`.
      Deleting is left out: the harness has no way to (the web app
      neither).
- [x] **`/` commands and skills** (`commands`, `skill`, `input-trigger`): a
      menu as `/` is typed — the TUI's commands, the harness's and the
      skills — ranked as the web app ranks them; a skill picked goes in the
      message and the harness loads it.
- [x] **`@` references** (`reference`): files and sessions, completed as
      typed — a file is a path the model reads, a session is attached as a
      read-only snapshot by the harness.
- [x] **Plan mode and goal** (`plan`, `goal`): a line over the composer
      for plan mode and one for the goal (phase, rounds, the /goal commands
      that apply), from the session's events, kept on resume.
- [x] **Deliverables** (`deliverables`): the files a turn changed, at its
      end, from the mutation tools' successful calls.

- [x] **MCP servers**: `/mcp` lists the servers the profile configures
      (`dsh-mcp-client` entries) and the tools each gave, or that it gave
      none; tend's MCP manager adds, removes and switches them. The web app
      has no MCP surface; this is the TUI's own.

## Phase 3 — the agent's wider work

- [ ] **Subagents** (`subagent`): their conversations, opened from the
      session.
- [ ] **Jobs and schedules** (`jobs`, `schedule`): background jobs and
      reminders of the session.
- [ ] **Workflow runs** (`workflow-run`).
- [ ] **Trajectory** (`trajectory`): the turn's event ledger with timings.

## Phase 4 — settings in the terminal

- [ ] **Models and keys** (`settings-models`): providers, keys (write-only),
      model lists, custom OpenAI-compatible routes — what
      `~/.dsh/settings.yaml` is edited by hand for today.
- [ ] **Plugins** (`settings-plugins`, `settings-plugin-inventory`).
- [ ] **Agent presets** (`agent-preset`).
- [ ] **Theme** (`theme`): light/dark/system, beside the OSC 11 detection
      already there.

## Phase 5 — polish

- [ ] **Attachments** (`attachment`): images by path, shown with the
      terminal's graphics where it has them.
- [ ] **Message feedback** (`message-feedback`).
- [ ] **Cordis panel** (`cordis`).

## Inside tend

tend already starts it ("DeepSeek Harness" in the agent manager and in a
group's "new agent here…"), reads its states (`dsh.toml`: working from the
status row) and recognises it typed in a shell. Phase 1's approvals give
tend a `blocked` state to report — a manifest rule on the approval prompt —
so a waiting harness is counted with the other agents that need somebody.

## Later, and apart

Paid routes (a gateway of Auth's, OpenAI-compatible, keyed per customer) and
the brand are a later project; nothing here depends on them.
