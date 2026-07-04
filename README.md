# slack-claude-code-bot

Two-way chat between Slack and Claude Code, **read-only** over one or more of your
code repositories, with human-gated Trello bug tickets. Mention the bot in a
channel and it answers questions about your codebase in the thread; reply in the
thread to keep the same Claude session and context.

## Setup

**Quick start:** run `sh setup.sh` — it checks Node, installs deps, seeds `.env`
from the example, builds, and runs the tests. Then fill in `.env` (step 2) and
do the Slack app config (step 3).

Manual steps:

1. `npm install`
2. Copy `.env.example` → `.env` and fill in tokens + repo paths.
3. Create a Slack app with Socket Mode enabled. Bot scopes: `app_mentions:read`,
   `chat:write`, `channels:history`, `groups:history`, and `files:read` (to read
   pasted screenshots). Subscribe to events `app_mention` and `message.channels`.
   Install to the workspace.
4. `npm test` — all suites green.
5. `npm run dev` — starts the bot.

## Usage

- `@bot why does this endpoint return 500?` — starts a thread; reply in-thread to
  continue with full context. Paste a screenshot and the bot will read it.
- When Claude proposes a bug ticket, click **Create Trello card** to file it or
  **Discard** to drop it.

## Optional features

- **Domain knowledge** — set `DOMAIN_PROMPT_FILE` to a local Markdown file
  (e.g. `prompts/domain.local.md`, gitignored) and its contents are appended to
  the system prompt. Put your schema names, routing docs, and product jargon
  there so they stay out of source. See `prompts/domain.example.md`.
- **Reporting database** — set all five `REPORTS_DB_*` vars to expose a
  read-only `query_reports_db` tool (single `SELECT`/`WITH`/`EXEC`, capped to
  100 rows). Use a dedicated read-only DB login.

## Run on a schedule (Windows)

To keep the bot running automatically on a **Mon–Fri 09:00–18:00** window,
register the included scheduled tasks:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-tasks.ps1
```

This creates four tasks (run as the current user, only when logged on):

- **ErpBot Start / Stop** — start at 09:00, stop at 18:00, weekdays only.
- **ErpBot Pull** — fast-forwards your read-only repo clones every 2h (no-ops
  outside the window).
- **ErpBot Guard** — at logon and every 15 min, starts the bot if it's down
  inside the window (self-healing crashes and missed wakes) and stops it
  outside. The window rule (Mon–Fri 09:00–18:00) is enforced by the scripts
  themselves, so the repeats are safe to fire around the clock.

Remove them with `scripts\uninstall-tasks.ps1`.

## Safety

Read-only: the bot may only `Read`, `Grep`, `Glob` the configured repos. No
edits, commits, pushes, or shell. Trello card creation is the only write side
effect and is always behind a human button click. The reporting-database tool,
if enabled, rejects any non-`SELECT`/`WITH`/`EXEC` statement.
