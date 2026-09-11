import { describe, it, expect, vi } from "vitest";
import { handleMessage, handleApprove, handleDiscard } from "../src/slackHandlers.js";
import { SessionManager } from "../src/sessionManager.js";
import { ProposalStore } from "../src/trelloTool.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function poster() {
  const posts: string[] = [];
  const blocks: any[][] = [];
  const updates: Array<[string, string]> = [];
  const uploads: Array<[string, Buffer]> = [];
  return {
    posts, blocks, updates, uploads,
    post: vi.fn(async (text: string) => { posts.push(text); return { ts: "m1" }; }),
    update: vi.fn(async (ts: string, text: string) => { updates.push([ts, text]); }),
    postBlocks: vi.fn(async (b: any[]) => { blocks.push(b); }),
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

const cfg: any = { trelloKey: "k", trelloToken: "t", trelloListId: "L" };

describe("handleMessage", () => {
  it("new thread: placeholder, runs query, persists session, edits with answer", async () => {
    const sessions = await freshSessions();
    const proposals = new ProposalStore();
    const run = vi.fn(async (_p: string, resume: string | undefined) => {
      expect(resume).toBeUndefined();
      return { sessionId: "sess-1", text: "the answer" };
    });
    const deps = { cfg, sessions, proposals, run, createCard: vi.fn() } as any;
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
    const deps = { cfg, sessions, proposals: new ProposalStore(), run, createCard: vi.fn() } as any;
    await handleMessage(deps, "t1", "follow up", poster());
    expect(run).toHaveBeenCalledOnce();
  });

  it("posts an approval card for each pending proposal", async () => {
    const sessions = await freshSessions();
    const proposals = new ProposalStore();
    const run = vi.fn(async () => {
      proposals.add({ title: "Bug", description: "d", severity: "High" });
      return { sessionId: "s", text: "found a bug" };
    });
    const deps = { cfg, sessions, proposals, run, createCard: vi.fn() } as any;
    const p = poster();
    await handleMessage(deps, "t1", "scan", p);
    expect(p.postBlocks).toHaveBeenCalledOnce();
    expect(JSON.stringify(p.blocks[0])).toContain("Bug");
  });

  it("attaches the run's query results as an Excel file after the answer", async () => {
    const sessions = await freshSessions();
    const run = vi.fn(async () => ({ sessionId: "s", text: "sales are up", exports: oneQuery }));
    const deps = { cfg, sessions, proposals: new ProposalStore(), run, createCard: vi.fn() } as any;
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
    const deps = { cfg, sessions, proposals: new ProposalStore(), run, createCard: vi.fn() } as any;
    const p = poster();
    await handleMessage(deps, "t1", "sales?", p);
    expect(p.uploadFile).not.toHaveBeenCalled();
  });

  it("a failed upload posts a warning, keeps the answer, and still posts proposals", async () => {
    const sessions = await freshSessions();
    const proposals = new ProposalStore();
    const run = vi.fn(async () => {
      proposals.add({ title: "Bug", description: "d", severity: "High" });
      return { sessionId: "s", text: "the answer", exports: oneQuery };
    });
    const deps = { cfg, sessions, proposals, run, createCard: vi.fn() } as any;
    const p = poster();
    p.uploadFile.mockRejectedValueOnce(new Error("missing_scope"));
    await handleMessage(deps, "t1", "sales?", p);
    expect(p.updates.at(-1)).toEqual(["m1", "the answer"]);
    expect(p.posts.at(-1)).toMatch(/Couldn't attach the Excel file: missing_scope/);
    expect(p.postBlocks).toHaveBeenCalledOnce();
  });

  it("on run error, edits placeholder with the error and does not throw", async () => {
    const sessions = await freshSessions();
    const run = vi.fn(async () => { throw new Error("sdk boom"); });
    const deps = { cfg, sessions, proposals: new ProposalStore(), run, createCard: vi.fn() } as any;
    const p = poster();
    await handleMessage(deps, "t1", "q", p);
    expect(p.updates[0][1]).toMatch(/sdk boom/);
  });
});

describe("handleApprove", () => {
  it("creates the card and posts its url, one-shot", async () => {
    const proposals = new ProposalStore();
    const prop = proposals.add({ title: "Bug", description: "d", severity: "High" });
    const createCard = vi.fn(async () => ({ id: "c1", url: "https://trello.com/c/c1" }));
    const deps = { cfg, proposals, createCard } as any;
    const p = poster();

    await handleApprove(deps, prop.id, p);
    expect(createCard).toHaveBeenCalledOnce();
    expect(p.posts.join("\n")).toContain("https://trello.com/c/c1");

    await handleApprove(deps, prop.id, p); // second click posts stale message
    expect(createCard).toHaveBeenCalledOnce();
    expect(p.posts[p.posts.length - 1]).toMatch(/no longer available/i);
  });

  it("posts 'no longer available' for an unknown id and does NOT call createCard", async () => {
    const proposals = new ProposalStore();
    const createCard = vi.fn();
    const deps = { cfg, proposals, createCard } as any;
    const p = poster();

    await handleApprove(deps, "nonexistent-id", p);

    expect(createCard).not.toHaveBeenCalled();
    expect(p.posts[0]).toMatch(/no longer available/i);
  });
});

describe("handleDiscard", () => {
  it("removes the proposal and posts a dismissal", async () => {
    const proposals = new ProposalStore();
    const prop = proposals.add({ title: "Bug", description: "d", severity: "Low" });
    const deps = { cfg, proposals, createCard: vi.fn() } as any;
    const p = poster();
    await handleDiscard(deps, prop.id, p);
    expect(p.posts.join("\n")).toMatch(/discard/i);
    expect(proposals.take(prop.id)).toBeUndefined();
  });

  it("posts 'no longer available' for an unknown id (not the discarded message)", async () => {
    const proposals = new ProposalStore();
    const deps = { cfg, proposals, createCard: vi.fn() } as any;
    const p = poster();

    await handleDiscard(deps, "nonexistent-id", p);

    expect(p.posts[0]).toMatch(/no longer available/i);
    expect(p.posts[0]).not.toMatch(/discard/i);
  });
});
