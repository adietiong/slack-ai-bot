import { readFile, writeFile, rename } from "node:fs/promises";

export class SessionManager {
  private map = new Map<string, string>();
  constructor(private filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const obj = JSON.parse(raw) as Record<string, string>;
      this.map = new Map(Object.entries(obj));
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        this.map = new Map();
        return;
      }
      throw err;
    }
  }

  get(threadTs: string): string | undefined {
    return this.map.get(threadTs);
  }

  async set(threadTs: string, sessionId: string): Promise<void> {
    this.map.set(threadTs, sessionId);
    const obj = Object.fromEntries(this.map);
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}
