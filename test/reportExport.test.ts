import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildReportWorkbook, reportFilename, type ReportExport } from "../src/reportExport.js";

async function load(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  return wb;
}

function exp(over: Partial<ReportExport>): ReportExport {
  return { sql: "SELECT 1", columns: [], rows: [], rowCount: 0, truncated: false, ...over };
}

describe("buildReportWorkbook", () => {
  it("returns null when no query returned rows", async () => {
    expect(await buildReportWorkbook([])).toBeNull();
    expect(await buildReportWorkbook([exp({})])).toBeNull();
  });

  it("writes one sheet per query with a header row and typed cells", async () => {
    const joined = new Date(Date.UTC(2026, 8, 11, 10, 30));
    const buf = await buildReportWorkbook([
      exp({
        columns: ["Agent", "Sales", "Active", "Joined", "Note"],
        rows: [{ Agent: "Ann", Sales: 1234.5, Active: true, Joined: joined, Note: null }],
        rowCount: 1,
      }),
    ]);
    const ws = (await load(buf!)).getWorksheet("Query 1")!;
    expect(ws.getCell("A1").value).toBe("Agent");
    expect(ws.getCell("E1").value).toBe("Note");
    expect(ws.getCell("A2").value).toBe("Ann");
    expect(ws.getCell("B2").value).toBe(1234.5);
    expect(ws.getCell("C2").value).toBe(true);
    expect(ws.getCell("D2").value).toEqual(joined);
    expect(ws.getCell("E2").value).toBeNull();
  });

  it("skips empty results and records each exported query's SQL", async () => {
    const buf = await buildReportWorkbook([
      exp({ sql: "SELECT id FROM none WHERE 1=0" }),
      exp({ sql: "SELECT id FROM t", columns: ["id"], rows: [{ id: 1 }, { id: 2 }], rowCount: 60000, truncated: true }),
    ]);
    const wb = await load(buf!);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Query 1", "Queries"]);
    const qs = wb.getWorksheet("Queries")!;
    expect(qs.getCell("A2").value).toBe("Query 1");
    expect(qs.getCell("B2").value).toBe(60000);
    expect(qs.getCell("C2").value).toBe(2);
    expect(qs.getCell("D2").value).toBe("SELECT id FROM t");
  });

  it("flattens values Excel can't hold natively", async () => {
    const buf = await buildReportWorkbook([
      exp({
        columns: ["big", "bin", "obj", "long"],
        rows: [{ big: 9007199254740993n, bin: Buffer.from([0xab, 0xcd]), obj: { a: 1 }, long: "x".repeat(40_000) }],
        rowCount: 1,
      }),
    ]);
    const ws = (await load(buf!)).getWorksheet("Query 1")!;
    expect(ws.getCell("A2").value).toBe("9007199254740993");
    expect(ws.getCell("B2").value).toBe("0xabcd");
    expect(ws.getCell("C2").value).toBe('{"a":1}');
    expect(String(ws.getCell("D2").value)).toHaveLength(32_767);
  });
});

describe("reportFilename", () => {
  it("stamps local date and time", () => {
    expect(reportFilename(new Date(2026, 8, 11, 14, 5))).toBe("report-2026-09-11-1405.xlsx");
  });
});
