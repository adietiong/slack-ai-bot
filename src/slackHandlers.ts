import type { Config } from "./config.js";
import type { SessionManager } from "./sessionManager.js";
import type { ImageInput } from "./claudeDriver.js";
import { buildReportWorkbook, reportFilename, type ReportExport } from "./reportExport.js";

export interface SlackPoster {
  post(text: string): Promise<{ ts: string }>;
  update(ts: string, text: string): Promise<void>;
  uploadFile(filename: string, data: Buffer, comment: string): Promise<void>;
}

export interface Deps {
  cfg: Config;
  sessions: SessionManager;
  run: (
    prompt: string,
    resumeId: string | undefined,
    onProgress?: (phrase: string) => void,
    images?: ImageInput[]
  ) => Promise<{ sessionId: string; text: string; exports?: ReportExport[] }>;
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

  let exports: ReportExport[] = [];
  try {
    const result = await deps.run(prompt, resumeId, (p) => {
      phrase = p;
    }, images);
    clearInterval(heartbeat);
    await deps.sessions.set(threadTs, result.sessionId);
    await poster.update(placeholder.ts, result.text || "(no output)");
    exports = result.exports ?? [];
    console.log(`[handleMessage] thread=${threadTs} OK session=${result.sessionId} chars=${result.text.length} queries=${exports.length}`);
  } catch (err: any) {
    clearInterval(heartbeat);
    console.error(`[handleMessage] thread=${threadTs} ERROR:`, err);
    await poster.update(placeholder.ts, `⚠️ Error: ${err?.message ?? String(err)}`);
    return;
  }
  await attachReportExports(exports, poster);
}

// Every DB query the run made that returned rows goes into one workbook on the
// thread. A failed attach must not lose the answer that is already posted, so
// it only reports itself.
async function attachReportExports(exports: ReportExport[], poster: SlackPoster): Promise<void> {
  try {
    const file = await buildReportWorkbook(exports);
    if (!file) {
      return;
    }
    await poster.uploadFile(reportFilename(), file, "📊 Query results as Excel");
  } catch (err: any) {
    console.error("[handleMessage] Excel attach failed:", err);
    await poster.post(`⚠️ Couldn't attach the Excel file: ${err?.message ?? String(err)}`);
  }
}
