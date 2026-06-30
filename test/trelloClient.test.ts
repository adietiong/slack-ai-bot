import { describe, it, expect, vi } from "vitest";
import { createTrelloCard } from "../src/trelloClient.js";

const auth = { key: "k", token: "t", listId: "L" };
const ticket = { title: "Null ref in payout", description: "stack...", severity: "High" };

describe("createTrelloCard", () => {
  it("POSTs to the cards endpoint with auth + list in the body (not the URL)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "c1", url: "https://trello.com/c/c1" }),
    });
    const card = await createTrelloCard(auth, ticket, fetchFn as any);

    expect(card).toEqual({ id: "c1", url: "https://trello.com/c/c1" });
    const url = (fetchFn.mock.calls[0][0] as string);
    expect(url).toBe("https://api.trello.com/1/cards");
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = init.body as string;
    expect(body).toContain("key=k");
    expect(body).toContain("token=t");
    expect(body).toContain("idList=L");
    const parsed = new URLSearchParams(body);
    expect(parsed.get("name")).toContain("Null ref in payout");
    expect(parsed.get("desc")).toContain("High");
  });

  it("throws on non-2xx with status and body", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid token",
    });
    await expect(createTrelloCard(auth, ticket, fetchFn as any)).rejects.toThrow(
      /401.*invalid token/
    );
  });
});
