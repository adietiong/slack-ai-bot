# Domain knowledge (example)

Copy this to `prompts/domain.local.md` (gitignored) and replace with your own
org-specific guidance. Whatever you put here is appended to the bot's base
system prompt at runtime via `DOMAIN_PROMPT_FILE`.

Good things to include:

- **Routing** — "If the user asks about X, read `docs/x.md` first and treat it as
  authoritative."
- **Reporting database** — the database name, the catalogued stored procedures to
  prefer (e.g. `usp_GetSalesSummary`), and how to pick between them.
- **Product jargon** — abbreviations and entity names specific to your system.
- **Conventions** — anything about your codebase the bot should assume.

Keep it factual and tight; it competes for the model's attention with the base
prompt.
