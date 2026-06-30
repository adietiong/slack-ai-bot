import "dotenv/config";
import pkg from "@slack/bolt";
const { App } = pkg;
import { loadConfig } from "./config.js";
import { SessionManager } from "./sessionManager.js";
import { ProposalStore, createTrelloMcpServer } from "./trelloTool.js";
import { createReportsMcpServer } from "./reportsTool.js";
import { runQuery } from "./claudeDriver.js";
import { downloadSlackImages } from "./slackFiles.js";
import { createTrelloCard } from "./trelloClient.js";
import {
  handleMessage,
  handleApprove,
  handleDiscard,
  type SlackPoster,
  type Deps,
} from "./slackHandlers.js";
import { APPROVE_ACTION, DISCARD_ACTION } from "./blocks.js";

const cfg = loadConfig(process.env);
const sessions = new SessionManager(cfg.sessionsFile);
await sessions.load();
const proposals = new ProposalStore();
const mcpServers: Record<string, unknown> = { trello: createTrelloMcpServer(proposals) };
if (cfg.reportsDb) {
  mcpServers.reports = createReportsMcpServer(cfg.reportsDb);
  console.log(`[startup] reports DB tool enabled (${cfg.reportsDb.database}, read-only)`);
} else {
  console.log("[startup] reports DB tool disabled (REPORTS_DB_* not set)");
}

const deps: Deps = {
  cfg,
  sessions,
  proposals,
  createCard: createTrelloCard,
  run: (prompt, resumeId, onProgress, images) =>
    runQuery(prompt, cfg, mcpServers, resumeId, undefined, undefined, onProgress, images),
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
    postBlocks: async (blocks) => {
      await client.chat.postMessage({ channel, thread_ts: threadTs, blocks, text: "Bug ticket proposal" });
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

app.action(APPROVE_ACTION, async ({ ack, action, body, client }) => {
  await ack();
  const proposalId = (action as any).value;
  const channel = (body as any).channel.id;
  const threadTs = (body as any).message.thread_ts ?? (body as any).message.ts;
  await handleApprove(deps, proposalId, makePoster(client, channel, threadTs));
});

app.action(DISCARD_ACTION, async ({ ack, action, body, client }) => {
  await ack();
  const proposalId = (action as any).value;
  const channel = (body as any).channel.id;
  const threadTs = (body as any).message.thread_ts ?? (body as any).message.ts;
  await handleDiscard(deps, proposalId, makePoster(client, channel, threadTs));
});

await app.start();
console.log("⚡ slack-claude-code-bot running (socket mode)");
