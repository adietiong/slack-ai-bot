import { describe, it, expect } from "vitest";
import {
  buildQueryOptions,
  permissionDecision,
  ALLOWED_TOOLS,
  runQuery,
  BASE_SYSTEM_PROMPT,
} from "../src/claudeDriver.js";

const cfg = {
  slackBotToken: "", slackAppToken: "", anthropicApiKey: "",
  backendPath: "/be", frontendPath: "/fe",
  trelloKey: "", trelloToken: "", trelloListId: "", sessionsFile: "",
};

describe("permissionDecision", () => {
  it("allows read-only + the trello propose tool", () => {
    for (const name of ALLOWED_TOOLS) {
      expect(permissionDecision(name).behavior).toBe("allow");
    }
  });
  it("denies Edit, Write, Bash", () => {
    for (const name of ["Edit", "Write", "Bash"]) {
      expect(permissionDecision(name).behavior).toBe("deny");
    }
  });
});

describe("buildQueryOptions", () => {
  it("sets both repo roots and the allowlist, no resume when omitted", () => {
    const o = buildQueryOptions(cfg as any, {}, undefined);
    expect(o.cwd).toBe("/be");
    expect(o.additionalDirectories).toEqual(["/fe"]);
    expect(o.allowedTools).toEqual(ALLOWED_TOOLS);
    expect(o.resume).toBeUndefined();
  });
  it("passes resume session id when provided", () => {
    const o = buildQueryOptions(cfg as any, {}, "sess-9");
    expect(o.resume).toBe("sess-9");
  });
  it("restricts built-in tools to read-only whitelist and hard-denies write tools", () => {
    const o = buildQueryOptions(cfg as any, {}, undefined);
    expect(o.tools).toEqual(["Read", "Grep", "Glob"]);
    expect((o.disallowedTools as string[])).toContain("Bash");
    expect((o.disallowedTools as string[])).toContain("Edit");
    expect((o.disallowedTools as string[])).toContain("Write");
  });
});

describe("runQuery", () => {
  it("accumulates assistant text and returns the session id", async () => {
    const fakeQuery = ((_args: any) =>
      (async function* () {
        yield { type: "system", subtype: "init", session_id: "sess-1" };
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello " }] },
        };
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: "world" }] },
        };
        yield { type: "result", subtype: "success", session_id: "sess-1" };
      })()) as any;

    const r = await runQuery("hi", cfg as any, {}, undefined, fakeQuery);
    expect(r.sessionId).toBe("sess-1");
    expect(r.text).toBe("Hello world");
  });

  it("rejects when the generator yields no session id", async () => {
    const fakeQuery = ((_args: any) =>
      (async function* () {
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: "some text" }] },
        };
      })()) as any;

    await expect(runQuery("hi", cfg as any, {}, undefined, fakeQuery)).rejects.toThrow(
      "Claude session produced no session id"
    );
  });
});

describe("runQuery timeout", () => {
  it("rejects with a timeout error when the stream never produces a terminal message", async () => {
    // fakeQuery yields one non-terminal message then awaits forever
    const hangingQuery = ((_args: any) =>
      (async function* () {
        yield { type: "system", subtype: "init", session_id: "sess-x" };
        await new Promise(() => {}); // never resolves
      })()) as any;

    await expect(
      runQuery("hi", cfg as any, {}, undefined, hangingQuery, 50)
    ).rejects.toThrow(/timed out/i);
  });
});

import { SYSTEM_PROMPT_APPEND } from "../src/claudeDriver.js";

describe("buildQueryOptions systemPrompt (bug triage)", () => {
  it("appends the triage system prompt onto the claude_code preset", () => {
    const o = buildQueryOptions(cfg as any, {}, undefined) as any;
    expect(o.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: BASE_SYSTEM_PROMPT,
    });
    expect(BASE_SYSTEM_PROMPT).toMatch(/propose_bug_ticket/);
    expect(BASE_SYSTEM_PROMPT).toMatch(/follow-up questions/i);
  });
});

import { progressPhrase } from "../src/claudeDriver.js";

describe("progressPhrase", () => {
  it("maps tools to human phrases", () => {
    expect(progressPhrase("Grep")).toMatch(/search/i);
    expect(progressPhrase("Glob")).toMatch(/files/i);
    expect(progressPhrase("Read", { file_path: "C:/x/AgentService.cs" })).toBe("Reading AgentService.cs…");
    expect(progressPhrase("mcp__trello__propose_bug_ticket")).toMatch(/ticket/i);
    expect(progressPhrase("Whatever")).toBe("Working…");
  });
});
