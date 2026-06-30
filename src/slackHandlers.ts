import type { Config } from "./config.js";
import type { SessionManager } from "./sessionManager.js";
import type { ProposalStore } from "./trelloTool.js";
import { approvalBlocks } from "./blocks.js";
import type { createTrelloCard } from "./trelloClient.js";
import type { ImageInput } from "./claudeDriver.js";

export interface SlackPoster {
  post(text: string): Promise<{ ts: string }>;
  update(ts: string, text: string): Promise<void>;
  postBlocks(blocks: any[]): Promise<void>;
}

export interface Deps {
  cfg: Config;
  sessions: SessionManager;
  proposals: ProposalStore;
  run: (
    prompt: string,
    resumeId: string | undefined,
    onProgress?: (phrase: string) => void,
    images?: ImageInput[]
  ) => Promise<{ sessionId: string; text: string }>;
  createCard: typeof createTrelloCard;
}

export async function handleMessage(
  deps: Deps,
  threadTs: string,
  prompt: string,
  poster: SlackPoster,
  images?: ImageInput[]
): Promise<void> {
  const resumeId = deps.sessions.get(threadTs);
  const placeholder = await poster.post("🤔 thinking…");
  const imgNote = images && images.length > 0 ? ` images=${images.length}` : "";
  console.log(`[handleMessage] thread=${threadTs} resume=${resumeId ?? "(new)"}${imgNote} prompt=${JSON.stringify(prompt).slice(0, 120)}`);

  // Animate the placeholder like Claude Code's own thinking indicator:
  // a pulsing star glyph + a cycling whimsical word + live elapsed seconds
  // (e.g. "✻ Pondering… (8s)"). Once a real tool runs, the progress phrase
  // takes over the word. Refreshed every 1.5s; Slack chat.update is tier-3
  // (~50/min/channel), so ~40/min stays under the limit.
  const STARS = ["✶", "✷", "✸", "✹", "✺", "✹", "✸", "✷"];
  const WORDS = [
    "Thinking", "Pondering", "Noodling", "Mulling", "Cogitating",
    "Ruminating", "Percolating", "Scheming", "Computing", "Reticulating",
  ];
  const started = Date.now();
  let frame = 0;
  let phrase = ""; // set by onProgress once a real tool runs
  const heartbeat = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000);
    frame = frame + 1;
    const star = STARS[frame % STARS.length];
    // No real tool yet → cycle a whimsical word like Claude does; else show it.
    const word = phrase || `${WORDS[Math.floor(frame / 3) % WORDS.length]}…`;
    poster.update(placeholder.ts, `${star} *${word}* _(${secs}s)_`).catch(() => {});
  }, 1500);

  try {
    const result = await deps.run(prompt, resumeId, (p) => {
      phrase = p;
    }, images);
    clearInterval(heartbeat);
    await deps.sessions.set(threadTs, result.sessionId);
    await poster.update(placeholder.ts, result.text || "(no output)");
    console.log(`[handleMessage] thread=${threadTs} OK session=${result.sessionId} chars=${result.text.length}`);
  } catch (err: any) {
    clearInterval(heartbeat);
    console.error(`[handleMessage] thread=${threadTs} ERROR:`, err);
    await poster.update(placeholder.ts, `⚠️ Error: ${err?.message ?? String(err)}`);
    return;
  }
  for (const proposal of deps.proposals.drainPending()) {
    await poster.postBlocks(approvalBlocks(proposal.id, proposal.ticket));
  }
}

const STALE_MSG = "⚠️ That proposal is no longer available (already actioned or the bot restarted). Ask again if you still want a ticket.";

export async function handleApprove(
  deps: Deps,
  proposalId: string,
  poster: SlackPoster
): Promise<void> {
  const proposal = deps.proposals.take(proposalId);
  if (!proposal) {
    await poster.post(STALE_MSG);
    return;
  }
  try {
    const card = await deps.createCard(
      { key: deps.cfg.trelloKey, token: deps.cfg.trelloToken, listId: deps.cfg.trelloListId },
      proposal.ticket
    );
    await poster.post(`✅ Trello card created: ${card.url}`);
  } catch (err: any) {
    await poster.post(`⚠️ Trello error: ${err?.message ?? String(err)}`);
  }
}

export async function handleDiscard(
  deps: Deps,
  proposalId: string,
  poster: SlackPoster
): Promise<void> {
  const taken = deps.proposals.take(proposalId);
  if (taken) {
    await poster.post("🗑️ Ticket discarded — nothing created.");
  } else {
    await poster.post(STALE_MSG);
  }
}
