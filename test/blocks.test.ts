import { describe, it, expect } from "vitest";
import { approvalBlocks, APPROVE_ACTION, DISCARD_ACTION } from "../src/blocks.js";

const ticket = { title: "Bug X", description: "details", severity: "Medium" };

describe("approvalBlocks", () => {
  it("embeds ticket fields and two buttons carrying the proposal id", () => {
    const blocks = approvalBlocks("p-1", ticket);
    const json = JSON.stringify(blocks);
    expect(json).toContain("Bug X");
    expect(json).toContain("Medium");

    const actions = blocks.find((b: any) => b.type === "actions");
    expect(actions.elements).toHaveLength(2);
    const ids = actions.elements.map((e: any) => e.action_id);
    expect(ids).toContain(APPROVE_ACTION);
    expect(ids).toContain(DISCARD_ACTION);
    for (const e of actions.elements) {
      expect(e.value).toBe("p-1");
    }
  });

  it("renders user-controlled fields as plain_text to prevent mrkdwn injection", () => {
    const blocks = approvalBlocks("p-1", ticket);
    const fieldsSection = blocks.find((b: any) => b.type === "section" && Array.isArray(b.fields));
    expect(fieldsSection).toBeDefined();
    const detailsField = fieldsSection.fields.find((f: any) => f.text?.startsWith("Details:"));
    expect(detailsField).toBeDefined();
    expect(detailsField.type).toBe("plain_text");
  });
});
