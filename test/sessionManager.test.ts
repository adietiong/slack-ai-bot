import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../src/sessionManager.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-"));
  file = join(dir, "sessions.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SessionManager", () => {
  it("returns undefined for unknown thread", async () => {
    const sm = new SessionManager(file);
    await sm.load();
    expect(sm.get("t1")).toBeUndefined();
  });

  it("stores and retrieves a mapping", async () => {
    const sm = new SessionManager(file);
    await sm.load();
    await sm.set("t1", "sess-1");
    expect(sm.get("t1")).toBe("sess-1");
  });

  it("persists across reload (survives restart)", async () => {
    const a = new SessionManager(file);
    await a.load();
    await a.set("t1", "sess-1");

    const b = new SessionManager(file);
    await b.load();
    expect(b.get("t1")).toBe("sess-1");
  });

  it("treats a missing file as empty", async () => {
    const sm = new SessionManager(join(dir, "nope.json"));
    await sm.load();
    expect(sm.get("x")).toBeUndefined();
  });
});
