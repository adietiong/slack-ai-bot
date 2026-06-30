import { readFileSync } from "node:fs";
import type { ReportsDbConfig } from "./reportsDb.js";

export interface Config {
  slackBotToken: string;
  slackAppToken: string;
  // Auth: exactly one of these is required. ANTHROPIC_API_KEY → pay-as-you-go
  // console credits; CLAUDE_CODE_OAUTH_TOKEN → Claude Pro/Max subscription.
  anthropicApiKey: string;
  claudeCodeOAuthToken: string;
  backendPath: string;
  frontendPath: string;
  trelloKey: string;
  trelloToken: string;
  trelloListId: string;
  sessionsFile: string;
  // Optional domain knowledge appended to the base system prompt. Loaded from
  // the file at DOMAIN_PROMPT_FILE (if set and readable). Keep org-specific
  // details (schema names, routing docs, product jargon) here — out of source.
  domainPrompt: string;
  // Optional — present only when all REPORTS_DB_* vars are set. Enables the
  // read-only reporting-database query tool.
  reportsDb?: ReportsDbConfig;
}

function loadDomainPrompt(path: string | undefined): string {
  if (!path) {
    return "";
  }
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return ""; // missing/unreadable domain file → run with the generic prompt
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const missing: string[] = [];
  const get = (k: string): string => {
    const v = env[k];
    if (!v) {
      missing.push(k);
      return "";
    }
    return v;
  };
  const cfg: Config = {
    slackBotToken: get("SLACK_BOT_TOKEN"),
    slackAppToken: get("SLACK_APP_TOKEN"),
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
    claudeCodeOAuthToken: env.CLAUDE_CODE_OAUTH_TOKEN ?? "",
    backendPath: get("BACKEND_PATH"),
    frontendPath: get("FRONTEND_PATH"),
    trelloKey: get("TRELLO_KEY"),
    trelloToken: get("TRELLO_TOKEN"),
    trelloListId: get("TRELLO_LIST_ID"),
    sessionsFile: env.SESSIONS_FILE || "./sessions.json",
    domainPrompt: loadDomainPrompt(env.DOMAIN_PROMPT_FILE),
  };
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
  if (!cfg.anthropicApiKey && !cfg.claudeCodeOAuthToken) {
    throw new Error(
      "Missing auth: set either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN"
    );
  }
  if (
    env.REPORTS_DB_SERVER &&
    env.REPORTS_DB_NAME &&
    env.REPORTS_DB_USER &&
    env.REPORTS_DB_PASSWORD
  ) {
    cfg.reportsDb = {
      server: env.REPORTS_DB_SERVER,
      port: Number(env.REPORTS_DB_PORT) || 1433,
      database: env.REPORTS_DB_NAME,
      user: env.REPORTS_DB_USER,
      password: env.REPORTS_DB_PASSWORD,
    };
  }
  return cfg;
}
