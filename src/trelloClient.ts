export interface TrelloAuth {
  key: string;
  token: string;
  listId: string;
}
export interface BugTicket {
  title: string;
  description: string;
  severity: string;
}
export interface TrelloCard {
  id: string;
  url: string;
}

export async function createTrelloCard(
  auth: TrelloAuth,
  ticket: BugTicket,
  fetchFn: typeof fetch = fetch
): Promise<TrelloCard> {
  const desc = `**Severity:** ${ticket.severity}\n\n${ticket.description}`;
  const body = new URLSearchParams({
    key: auth.key,
    token: auth.token,
    idList: auth.listId,
    name: ticket.title,
    desc,
  });
  const url = "https://api.trello.com/1/cards";
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trello API ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { id: string; url: string };
  return { id: json.id, url: json.url };
}
