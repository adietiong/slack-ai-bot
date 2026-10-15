import { describe, it, expect, vi } from "vitest";
import { handleMessage, routeEvent } from "../src/slackHandlers.js";
import { SessionManager } from "../src/sessionManager.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function poster() {
  const posts: string[] = [];
  const updates: Array<[string, string]> = [];
  const uploads: Array<[string, Buffer]> = [];
  return {
    posts, updates, uploads,
    post: vi.fn(async (text: string) => { posts.push(text); return { ts: "m1" }; }),
    update: vi.fn(async (ts: string, text: string) => { updates.push([ts, text]); }),
    uploadFile: vi.fn(async (name: string, data: Buffer) => { uploads.push([name, data]); }),
  };
}

const oneQuery = [{ sql: "SELECT id FROM t", columns: ["id"], rows: [{ id: 1 }], rowCount: 1, truncated: false }];

async function freshSessions() {
  const dir = mkdtempSync(join(tmpdir(), "sh-"));
  const sm = new SessionManager(join(dir, "s.json"));
  await sm.load();
  return sm;
}

const cfg: any = {};

describe("handleMessage", () => {
  it("new thread: placeholder, runs query, persists session, edits with answer", async () => {
    const sessions = await freshSessions();
    const run = vi.fn(async (_p: string, resume: string | undefined) => {
      expect(resume).toBeUndefined();
      return { sessionId: "sess-1", text: "the answer" };
    });
    const deps = { cfg, sessions, run } as any;
    const p = poster();

    await handleMessage(deps, "t1", "why null?", p);

    expect(p.post).toHaveBeenCalledOnce();
    expect(p.posts[0]).toMatch(/thinking/i);
    expect(p.updates[0]).toEqual(["m1", "the answer"]);
    expect(sessions.get("t1")).toBe("sess-1");
  });

  it("known thread: passes the stored session id as resume", async () => {
    const sessions = await freshSessions();
    await sessions.set("t1", "sess-prev");
    const run = vi.fn(async (_p: string, resume: string | undefined) => {
      expect(resume).toBe("sess-prev");
      return { sessionId: "sess-prev", text: "ok" };
    });
    const deps = { cfg, sessions, run } as any;
    await handleMessage(deps, "t1", "follow up", poster());
    expect(run).toHaveBeenCalledOnce();
  });

  it("attaches the run's query results as an Excel file after the answer", async () => {
    const sessions = await freshSessions();
    const run = vi.fn(async () => ({ sessionId: "s", text: "sales are up", exports: oneQuery }));
    const deps = { cfg, sessions, run } as any;
    const p = poster();
    await handleMessage(deps, "t1", "sales?", p);
    expect(p.uploadFile).toHaveBeenCalledOnce();
    expect(p.uploads[0][0]).toMatch(/^report-.*\.xlsx$/);
    expect(p.uploads[0][1].subarray(0, 2).toString()).toBe("PK"); // xlsx is a zip
    expect(p.update.mock.invocationCallOrder.at(-1)!).toBeLessThan(p.uploadFile.mock.invocationCallOrder[0]);
  });

  it("attaches nothing when no query returned rows", async () => {
    const sessions = await freshSessions();
    const run = vi.fn(async () => ({
      sessionId: "s",
      text: "no rows",
      exports: [{ ...oneQuery[0], rows: [], rowCount: 0 }],
    }));
    const deps = { cfg, sessions, run } as any;
    const p = poster();
    await handleMessage(deps, "t1", "sales?", p);
    expect(p.uploadFile).not.toHaveBeenCalled();
  });

  it("a failed upload posts a warning and keeps the answer", async () => {
    const sessions = await freshSessions();
    const run = vi.fn(async () => ({ sessionId: "s", text: "the answer", exports: oneQuery }));
    const deps = { cfg, sessions, run } as any;
    const p = poster();
    p.uploadFile.mockRejectedValueOnce(new Error("missing_scope"));
    await handleMessage(deps, "t1", "sales?", p);
    expect(p.updates.at(-1)).toEqual(["m1", "the answer"]);
    expect(p.posts.at(-1)).toMatch(/Couldn't attach the Excel file: missing_scope/);
  });

  it("on run error, edits placeholder with the error and does not throw", async () => {
    const sessions = await freshSessions();
    const run = vi.fn(async () => { throw new Error("sdk boom"); });
    const deps = { cfg, sessions, run } as any;
    const p = poster();
    await handleMessage(deps, "t1", "q", p);
    expect(p.updates[0][1]).toMatch(/sdk boom/);
  });
});

describe("routeEvent", () => {
  const sessions = { get: (ts: string) => (ts === "owned" ? "sess-1" : undefined) };

  it("answers an @mention in an owned thread once, whichever event arrives first", () => {
    const m = { channel: "C1", ts: "2", thread_ts: "owned", text: "<@U1> hi" };
    const a = new Set<string>();
    expect(routeEvent("mention", m, sessions, a)).toBe("owned");
    expect(routeEvent("message", m, sessions, a)).toBeUndefined();
    const b = new Set<string>();
    expect(routeEvent("message", m, sessions, b)).toBe("owned");
    expect(routeEvent("mention", m, sessions, b)).toBeUndefined();
  });

  it("still answers via app_mention alone when no message event comes (private channel)", () => {
    expect(routeEvent("mention", { channel: "G1", ts: "2", thread_ts: "owned" }, sessions, new Set())).toBe("owned");
  });

  it("keeps messages with the same ts in different channels apart", () => {
    const seen = new Set<string>();
    expect(routeEvent("mention", { channel: "C1", ts: "9" }, sessions, seen)).toBe("9");
    expect(routeEvent("mention", { channel: "C2", ts: "9" }, sessions, seen)).toBe("9");
  });

  it("starts a thread from a top-level @mention or one in a thread it doesn't own", () => {
    expect(routeEvent("mention", { channel: "C1", ts: "5" }, sessions, new Set())).toBe("5");
    expect(routeEvent("mention", { channel: "C1", ts: "6", thread_ts: "other" }, sessions, new Set())).toBe("other");
  });

  it("continues only owned threads for plain and file_share messages", () => {
    expect(routeEvent("message", { channel: "C1", ts: "3", thread_ts: "owned" }, sessions, new Set())).toBe("owned");
    expect(routeEvent("message", { channel: "C1", ts: "3", thread_ts: "owned", subtype: "file_share" }, sessions, new Set())).toBe("owned");
    expect(routeEvent("message", { channel: "C1", ts: "3", thread_ts: "other" }, sessions, new Set())).toBeUndefined();
    expect(routeEvent("message", { channel: "C1", ts: "3" }, sessions, new Set())).toBeUndefined();
  });

  it("ignores edits, bot messages and empty events without marking them seen", () => {
    const seen = new Set<string>();
    expect(routeEvent("message", { channel: "C1", ts: "3", thread_ts: "owned", subtype: "message_changed" }, sessions, seen)).toBeUndefined();
    expect(routeEvent("message", { channel: "C1", ts: "3", thread_ts: "owned", bot_id: "B1" }, sessions, seen)).toBeUndefined();
    expect(routeEvent("mention", { channel: "C1", ts: "3", bot_id: "B1" }, sessions, seen)).toBeUndefined();
    expect(routeEvent("mention", undefined, sessions, seen)).toBeUndefined();
    expect(seen.size).toBe(0);
  });

  it("forgets the oldest entries past 500", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 501; i++) { routeEvent("mention", { channel: "C1", ts: String(i) }, sessions, seen); }
    expect(seen.size).toBe(500);
    expect(seen.has("C1:0")).toBe(false);
    expect(routeEvent("mention", { channel: "C1", ts: "0" }, sessions, seen)).toBe("0");
  });
});
