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

## If you connect a reporting database

The base prompt already forbids stating a number the bot did not read from a
`query_reports_db` result. Reinforce it here with your own specifics — the rule
survives better when it names real tables and real filters:

- The filter that most changes your numbers (a cancelled/void status, a soft
  delete flag, a house or test account) and roughly how much it moves them.
- Which column is the correct measure for each entity type, if more than one
  looks plausible.
- How to resolve a name to an id, and what to do when a name is ambiguous.

An LLM re-deriving SQL from prose will pick a wrong-but-plausible column and
report the result with full confidence. A fabricated table is correctly
formatted and cannot be spotted by reading it, so the guard has to stop it
being written rather than catch it afterwards. If the numbers matter, prefer a
stored procedure or a parameterised tool over free-form SQL, so the measure and
the filters are fixed in code instead of chosen per question.
