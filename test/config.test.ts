import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const full = {
  SLACK_BOT_TOKEN: "xoxb",
  SLACK_APP_TOKEN: "xapp",
  ANTHROPIC_API_KEY: "sk",
  BACKEND_PATH: "/be",
  FRONTEND_PATH: "/fe",
  TRELLO_KEY: "k",
  TRELLO_TOKEN: "t",
  TRELLO_LIST_ID: "l",
};

describe("loadConfig", () => {
  it("maps env to a Config object", () => {
    const c = loadConfig(full as any);
    expect(c.backendPath).toBe("/be");
    expect(c.trelloListId).toBe("l");
    expect(c.sessionsFile).toBe("./sessions.json");
  });

  it("honours SESSIONS_FILE override", () => {
    const c = loadConfig({ ...full, SESSIONS_FILE: "/tmp/s.json" } as any);
    expect(c.sessionsFile).toBe("/tmp/s.json");
  });

  it("throws listing all missing required keys", () => {
    expect(() => loadConfig({ SLACK_BOT_TOKEN: "x" } as any)).toThrow(
      /Missing required env:.*SLACK_APP_TOKEN/
    );
  });

  it("accepts CLAUDE_CODE_OAUTH_TOKEN in place of ANTHROPIC_API_KEY", () => {
    const { ANTHROPIC_API_KEY, ...noKey } = full;
    const c = loadConfig({ ...noKey, CLAUDE_CODE_OAUTH_TOKEN: "oauth-tok" } as any);
    expect(c.anthropicApiKey).toBe("");
    expect(c.claudeCodeOAuthToken).toBe("oauth-tok");
  });

  it("throws when neither auth method is set", () => {
    const { ANTHROPIC_API_KEY, ...noKey } = full;
    expect(() => loadConfig(noKey as any)).toThrow(
      /either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN/
    );
  });
});
