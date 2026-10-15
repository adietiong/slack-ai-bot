import "dotenv/config";
import pkg from "@slack/bolt";
const { App } = pkg;
import { loadConfig } from "./config.js";
import { SessionManager } from "./sessionManager.js";
import { createReportsMcpServer } from "./reportsTool.js";
import type { ReportExport } from "./reportExport.js";
import { runQuery } from "./claudeDriver.js";
import { downloadSlackImages, readSlackSpreadsheets, readSlackTables } from "./slackFiles.js";
import { handleMessage, routeEvent, type SlackPoster, type Deps } from "./slackHandlers.js";

const cfg = loadConfig(process.env);
const sessions = new SessionManager(cfg.sessionsFile);
await sessions.load();
if (cfg.reportsDb) {
  console.log(`[startup] reports DB tool enabled (${cfg.reportsDb.database}, read-only)`);
} else {
  console.log("[startup] reports DB tool disabled (REPORTS_DB_* not set)");
}

const deps: Deps = {
  cfg,
  sessions,
  run: async (prompt, resumeId, onProgress, images) => {
    // Fresh reports server per run so the captured query results belong to
    // this reply only, even when two threads are being answered at once.
    const exports: ReportExport[] = [];
    const servers: Record<string, unknown> = cfg.reportsDb
      ? { reports: createReportsMcpServer(cfg.reportsDb, (e) => exports.push(e)) }
      : {};
    const result = await runQuery(prompt, cfg, servers, resumeId, undefined, undefined, onProgress, images);
    return { ...result, exports };
  },
};

const app = new App({
  token: cfg.slackBotToken,
  appToken: cfg.slackAppToken,
  socketMode: true,
});

function makePoster(client: any, channel: string, threadTs: string): SlackPoster {
  return {
    post: async (text) => {
      const r = await client.chat.postMessage({ channel, thread_ts: threadTs, text });
      return { ts: r.ts as string };
    },
    update: async (ts, text) => {
      await client.chat.update({ channel, ts, text });
    },
    uploadFile: async (filename, data, comment) => {
      await client.files.uploadV2({
        channel_id: channel,
        thread_ts: threadTs,
        file: data,
        filename,
        title: filename,
        initial_comment: comment,
      });
    },
  };
}

// Text + spreadsheets + pasted tables + images of one Slack message, then answer it.
// Only a mention's own text drops <@…> tags; a follow-up keeps "ask <@U…>" intact.
async function answer(m: any, threadTs: string, client: any, stripMentions: boolean): Promise<void> {
  const text: string = m.text ?? "";
  const prompt = (stripMentions ? text.replace(/<@[^>]+>/g, "") : text).trim();
  const images = await downloadSlackImages(m.files, cfg.slackBotToken);
  const sheets = await readSlackSpreadsheets(m.files, cfg.slackBotToken);
  const tables = readSlackTables(m);
  await handleMessage(deps, threadTs, [prompt, sheets, tables].filter(Boolean).join("\n\n"), makePoster(client, m.channel, threadTs), images);
}

// An @mention in an owned thread fires both handlers; this lets only the first answer.
const seen = new Set<string>();

// New question: @mention starts a new thread (threadTs = the mention's own ts).
app.event("app_mention", async ({ event, client }) => {
  const threadTs = routeEvent("mention", event, sessions, seen);
  if (threadTs) { await answer(event, threadTs, client, true); }
});

// Follow-up: a non-bot message inside a known thread continues that session.
app.message(async ({ message, client }) => {
  const threadTs = routeEvent("message", message, sessions, seen);
  if (threadTs) { await answer(message, threadTs, client, false); }
});

// @slack/socket-mode@1.3.6 drives its websocket through the `finity` state
// machine, which has no transition for a 'server explicit disconnect' that
// arrives while still in 'connecting'. It throws, nothing catches it, and the
// process dies mid-handshake — the unattended-crash cause we kept blaming on
// the scheduler. Swallow that one event so the client's own reconnect can
// run; anything else stays fatal and exits for the guard task to restart.
// Proper fix is socket-mode 2.x (drops finity) = a breaking Bolt 3 -> 4/5 bump.
process.on("uncaughtException", (err) => {
  const isSocketModeStateBug =
    err instanceof Error && /Unhandled event '.*disconnect.*' in state/i.test(err.message);
  if (isSocketModeStateBug) {
    console.error(`[socket-mode] ignoring known state-machine bug: ${err.message}`);
    return;
  }
  console.error("[fatal] uncaught exception:", err);
  process.exit(1);
});

await app.start();
console.log("⚡ slack-claude-code-bot running (socket mode)");
