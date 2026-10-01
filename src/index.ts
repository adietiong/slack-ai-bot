import "dotenv/config";
import pkg from "@slack/bolt";
const { App } = pkg;
import { loadConfig } from "./config.js";
import { SessionManager } from "./sessionManager.js";
import { createReportsMcpServer } from "./reportsTool.js";
import type { ReportExport } from "./reportExport.js";
import { runQuery } from "./claudeDriver.js";
import { downloadSlackImages } from "./slackFiles.js";
import { handleMessage, type SlackPoster, type Deps } from "./slackHandlers.js";

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

// New question: @mention starts a new thread (threadTs = the mention's own ts).
app.event("app_mention", async ({ event, client }) => {
  if ((event as any).bot_id) { return; }
  const threadTs = (event as any).thread_ts ?? (event as any).ts;
  const channel = (event as any).channel;
  const prompt = (event as any).text.replace(/<@[^>]+>/g, "").trim();
  const images = await downloadSlackImages((event as any).files, cfg.slackBotToken);
  await handleMessage(deps, threadTs, prompt, makePoster(client, channel, threadTs), images);
});

// Follow-up: a non-bot message inside a known thread continues that session.
app.message(async ({ message, client }) => {
  const m = message as any;
  // file_share is a "subtype" but it's a real user message with an attachment.
  const isFileShare = m.subtype === "file_share";
  if ((m.subtype && !isFileShare) || m.bot_id || !m.thread_ts) {
    return; // ignore bot echoes, edits, and non-threaded chatter
  }
  if (!sessions.get(m.thread_ts)) {
    return; // only continue threads the bot already owns
  }
  const images = await downloadSlackImages(m.files, cfg.slackBotToken);
  await handleMessage(deps, m.thread_ts, (m.text ?? "").trim(), makePoster(client, m.channel, m.thread_ts), images);
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
