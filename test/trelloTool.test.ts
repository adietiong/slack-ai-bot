import { describe, it, expect } from "vitest";
import { ProposalStore } from "../src/trelloTool.js";

const t = { title: "A", description: "d", severity: "Low" };

describe("ProposalStore", () => {
  it("add returns a proposal with a stable unique id", () => {
    const s = new ProposalStore();
    const p1 = s.add(t);
    const p2 = s.add(t);
    expect(p1.id).not.toBe(p2.id);
    expect(p1.ticket.title).toBe("A");
  });

  it("take returns then removes a proposal (one-shot)", () => {
    const s = new ProposalStore();
    const p = s.add(t);
    expect(s.take(p.id)?.id).toBe(p.id);
    expect(s.take(p.id)).toBeUndefined();
  });

  it("drainPending returns proposals added since last drain then clears", () => {
    const s = new ProposalStore();
    s.add(t);
    s.add(t);
    expect(s.drainPending()).toHaveLength(2);
    expect(s.drainPending()).toHaveLength(0);
  });
});
