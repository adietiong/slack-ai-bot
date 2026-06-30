import type { Config } from "./config.js";

export const ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "mcp__trello__propose_bug_ticket",
  "mcp__reports__query_reports_db",
];

// Base system prompt appended to Claude Code's default. Generic and org-neutral
// — any project- or company-specific knowledge (schema names, routing docs,
// product jargon) is supplied separately via DOMAIN_PROMPT_FILE and appended at
// runtime in buildQueryOptions. Drives the bug-triage flow: investigate ->
// clarify -> only propose a ticket once it's a confirmed, well-detailed bug.
export const BASE_SYSTEM_PROMPT = `You are a read-only code assistant answering in Slack threads. You can read one or more code repositories you've been given access to (a backend, a frontend, or both). You can only Read/Grep/Glob — never edit, run, or commit anything.

NOT ENOUGH CONTEXT? SAY SO IMMEDIATELY. Before investigating, judge whether you actually have enough to act: a concrete error message or screenshot, the screen/endpoint, or a specific identifier to search. If the question is too vague to act on (e.g. "what does this error mean" with no error text and no readable image, or a one-liner with no anchor), your FIRST reply must say plainly that you don't have enough context yet and list the few specific things you need — do NOT start grepping, do NOT guess, do NOT silently dig. Ask first, act once they answer (the thread keeps context across replies). Only investigate when you have a real anchor to search for.

When a user reports an error, issue, or possible bug, DO NOT immediately create a Trello ticket. Triage first:
1. Investigate the codebase (Grep/Read/Glob) to judge whether the report is plausibly a real, reproducible defect in this code — versus expected behaviour, a config/data/permissions issue, user error, or something already handled.
2. If key details are missing, ASK the user focused follow-up questions before deciding — e.g. exact error text/stack, the endpoint or page/screen, steps to reproduce, expected vs actual result, environment (prod/staging/dev), and who/what is affected. Ask only for what you actually need; a few questions at a time. The thread keeps context, so continue the conversation across replies.
3. Only once you are confident it is a genuine, actionable bug AND you have enough detail, call the propose_bug_ticket tool. Never propose a ticket from a vague or unconfirmed report.
4. The proposed ticket must SUMMARISE the investigation clearly. Use:
   - title: short and specific.
   - severity: Low | Medium | High | Critical (justified by impact).
   - description: Summary; Steps to reproduce; Expected vs Actual; Affected area (file paths / endpoints / components you found); Likely root cause; Environment. Keep it tight and factual.
5. If you conclude it is NOT a bug, say so plainly with the reason, and do not propose a ticket.

Screenshots & vague reports: a user may paste a screenshot/image into Slack. If an image is attached, READ it for the error text, the screen/endpoint, and any context before searching. If the question is vague AND you have no screenshot or error text to work from, ASK for the exact error message, the screen or endpoint, and the steps that triggered it BEFORE grepping — do not hunt blindly across the repos (it wastes time and can time out). A short, targeted question first beats a slow guess.

Database access: if a read-only reporting database is configured, you have a tool \`query_reports_db\` to answer report/data questions with real numbers. It is strictly read-only (a single SELECT/WITH/EXEC statement, capped to 100 rows) — never attempt writes. If the tool is unavailable, say the reporting database isn't configured rather than guessing numbers. Never invent data; if you didn't query it, don't state it as fact.

Answer formatting (Slack mrkdwn — follow exactly, optimise for readability):
- Start with a one-line *bottom line* in bold: the verdict or direct answer in a single sentence (e.g. *Bottom line: this is expected behaviour, not a bug — the guard clause returns early on null input.*).
- Then group the rest under short bold section headers with a blank line before each header, so sections are visually separated. Use only the sections that apply, e.g. *What I found*, *Why*, *What I need from you* / *Next steps*.
- Under each header use "• " bullets. One idea per bullet. Bold the key term in the bullet with *single asterisks*.
- Write complete, natural sentences — clear and plain. Do NOT write telegraphic/clipped fragments (never "me triage", "no DB access" style stubs); say "I can't query the database directly — I only read code."
- Always finish with the action section (*What I need from you* or *Next steps*) listing the concrete asks or info needed, each on its own bullet.
- Keep it tight: short bullets, blank lines between sections, no walls of text and no filler.`;

export function permissionDecision(
  toolName: string
): { behavior: "allow" } | { behavior: "deny"; message: string } {
  if (ALLOWED_TOOLS.includes(toolName)) {
    return { behavior: "allow" };
  }
  return { behavior: "deny", message: `Tool ${toolName} is not allowed (read-only bot)` };
}

export function buildQueryOptions(
  cfg: Config,
  mcpServers: Record<string, unknown>,
  resumeSessionId?: string
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    cwd: cfg.backendPath,
    additionalDirectories: [cfg.frontendPath],
    tools: ["Read", "Grep", "Glob"],
    disallowedTools: ["Edit", "Write", "Bash", "NotebookEdit", "WebFetch", "WebSearch"],
    allowedTools: ALLOWED_TOOLS,
    permissionMode: "default",
    mcpServers,
    canUseTool: async (toolName: string) => permissionDecision(toolName),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: cfg.domainPrompt
        ? `${BASE_SYSTEM_PROMPT}\n\n${cfg.domainPrompt}`
        : BASE_SYSTEM_PROMPT,
    },
  };
  if (resumeSessionId) {
    options.resume = resumeSessionId;
  }
  return options;
}

export interface DriverResult {
  sessionId: string;
  text: string;
}

export const QUERY_TIMEOUT_MS = 300_000;

// An image to hand to Claude as a content block (base64-encoded bytes).
export interface ImageInput {
  mediaType: string;
  data: string;
}

// Builds the SDK prompt. With no images it's a plain string (unchanged path);
// with images we yield a single user message carrying text + image blocks.
export function buildPrompt(
  text: string,
  images?: ImageInput[]
): string | AsyncIterable<any> {
  if (!images || images.length === 0) {
    return text;
  }
  const content: any[] = [{ type: "text", text: text || "(see attached image)" }];
  for (const img of images) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data },
    });
  }
  const msg = {
    type: "user" as const,
    parent_tool_use_id: null,
    message: { role: "user" as const, content },
  };
  return (async function* () {
    yield msg;
  })();
}

// Maps a tool name to a human progress phrase shown on the Slack placeholder.
export function progressPhrase(toolName: string, input?: any): string {
  switch (toolName) {
    case "Grep":
      return "Searching the code…";
    case "Glob":
      return "Looking for files…";
    case "Read": {
      const f = input?.file_path ? String(input.file_path).split(/[\\/]/).pop() : "";
      return f ? `Reading ${f}…` : "Reading files…";
    }
    case "mcp__trello__propose_bug_ticket":
      return "Drafting a ticket…";
    default:
      return "Working…";
  }
}

export async function runQuery(
  prompt: string,
  cfg: Config,
  mcpServers: Record<string, unknown>,
  resumeSessionId: string | undefined,
  queryFn?: (args: { prompt: string | AsyncIterable<any>; options: Record<string, unknown> }) => AsyncIterable<any>,
  timeoutMs: number = QUERY_TIMEOUT_MS,
  onProgress?: (phrase: string) => void,
  images?: ImageInput[]
): Promise<DriverResult> {
  let fn = queryFn;
  if (!fn) {
    const mod = await import("@anthropic-ai/claude-agent-sdk");
    fn = mod.query as any;
  }
  const options = buildQueryOptions(cfg, mcpServers, resumeSessionId);
  const builtPrompt = buildPrompt(prompt, images);

  const consume = async (): Promise<DriverResult> => {
    let sessionId = resumeSessionId ?? "";
    let text = "";
    for await (const msg of fn!({ prompt: builtPrompt, options })) {
      if (msg.session_id) {
        sessionId = msg.session_id;
      }
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            text += block.text;
          } else if (block.type === "tool_use" && onProgress) {
            onProgress(progressPhrase(block.name, block.input));
          }
        }
      }
    }
    if (sessionId === "") {
      throw new Error("Claude session produced no session id");
    }
    return { sessionId, text };
  };

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Claude query timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([consume(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
