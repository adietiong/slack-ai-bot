import { describe, it, expect, vi } from "vitest";
import { runReportsQuery, MODEL_ROWS, EXPORT_MAX_ROWS } from "../src/reportsTool.js";
import type { ReportExport } from "../src/reportExport.js";

const cfg: any = {};

describe("runReportsQuery", () => {
  it("shows the model at most 100 rows but hands the full result to the export sink", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i }));
    const queryFn = vi.fn(async () => ({ columns: ["id"], rows, rowCount: 250, truncated: false }));
    const captured: ReportExport[] = [];

    const out = await runReportsQuery("SELECT id FROM t", cfg, (e) => captured.push(e), queryFn);

    expect(queryFn).toHaveBeenCalledWith("SELECT id FROM t", cfg, EXPORT_MAX_ROWS);
    const text = out.content[0].text;
    expect(text).toContain("showing first 100 of 250");
    expect(text).toMatch(/attached to the thread as an Excel file/);
    expect(JSON.parse(text.slice(text.indexOf("[")))).toHaveLength(MODEL_ROWS);
    expect(captured).toHaveLength(1);
    expect(captured[0].sql).toBe("SELECT id FROM t");
    expect(captured[0].rows).toHaveLength(250);
  });

  it("says when the export itself was capped", async () => {
    const rows = [{ id: 1 }];
    const queryFn = vi.fn(async () => ({ columns: ["id"], rows, rowCount: 80000, truncated: true }));
    const out = await runReportsQuery("SELECT id FROM t", cfg, () => {}, queryFn);
    expect(out.content[0].text).toContain("first 1 of 80000 rows");
  });

  it("does not promise an attachment when nothing captures results", async () => {
    const queryFn = vi.fn(async () => ({ columns: ["id"], rows: [{ id: 1 }], rowCount: 1, truncated: false }));
    const out = await runReportsQuery("SELECT id FROM t", cfg, undefined, queryFn);
    expect(out.content[0].text).not.toMatch(/Excel/);
  });

  it("captures nothing and returns isError when the query fails", async () => {
    const queryFn = vi.fn(async () => { throw new Error("timeout"); });
    const captured: ReportExport[] = [];
    const out = await runReportsQuery("SELECT 1", cfg, (e) => captured.push(e), queryFn);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("timeout");
    expect(captured).toHaveLength(0);
  });
});
