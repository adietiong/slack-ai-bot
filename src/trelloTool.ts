import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { BugTicket } from "./trelloClient.js";

export interface Proposal {
  id: string;
  ticket: BugTicket;
}

export class ProposalStore {
  private counter = 0;
  private all = new Map<string, Proposal>();
  private pending: Proposal[] = [];

  add(ticket: BugTicket): Proposal {
    const id = `p-${++this.counter}`;
    const p: Proposal = { id, ticket };
    this.all.set(id, p);
    this.pending.push(p);
    return p;
  }

  take(id: string): Proposal | undefined {
    const p = this.all.get(id);
    if (p) {
      this.all.delete(id);
    }
    return p;
  }

  drainPending(): Proposal[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }
}

export function createTrelloMcpServer(store: ProposalStore): unknown {
  return createSdkMcpServer({
    name: "trello",
    version: "1.0.0",
    tools: [
      tool(
        "propose_bug_ticket",
        "Propose a Trello bug ticket for human approval. Does NOT create the card; a human must approve it in Slack.",
        {
          title: z.string().describe("Short bug title"),
          description: z.string().describe("What is wrong, where, and why"),
          severity: z.enum(["Low", "Medium", "High", "Critical"]),
        },
        async (args) => {
          const p = store.add({
            title: args.title,
            description: args.description,
            severity: args.severity,
          });
          return {
            content: [
              {
                type: "text",
                text: `Proposed bug ticket "${args.title}" (id ${p.id}). Awaiting human approval in Slack — not yet created.`,
              },
            ],
          };
        }
      ),
    ],
  });
}
