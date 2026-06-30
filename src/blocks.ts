import type { BugTicket } from "./trelloClient.js";

export const APPROVE_ACTION = "trello_create";
export const DISCARD_ACTION = "trello_discard";

export function approvalBlocks(proposalId: string, ticket: BugTicket): any[] {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: "*Proposed bug ticket*" },
    },
    {
      type: "section",
      fields: [
        { type: "plain_text", text: `Title: ${ticket.title}` },
        { type: "plain_text", text: `Severity: ${ticket.severity}` },
        { type: "plain_text", text: `Details: ${ticket.description.slice(0, 2000)}` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Create Trello card" },
          action_id: APPROVE_ACTION,
          value: proposalId,
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "Discard" },
          action_id: DISCARD_ACTION,
          value: proposalId,
        },
      ],
    },
  ];
}
