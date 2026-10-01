import { describe, it, expect, vi } from "vitest";
import { handleMessage } from "../src/slackHandlers.js";
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
