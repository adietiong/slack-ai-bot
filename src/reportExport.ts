import ExcelJS from "exceljs";
import type { ReportsQueryResult } from "./reportsDb.js";

// One successful query_reports_db call, captured so its real rows can be
// attached to the thread as Excel. Built from the tool result, never from the
// model's text, so the file can only hold numbers the database returned.
export interface ReportExport extends ReportsQueryResult {
  sql: string;
}

const MAX_CELL_CHARS = 32_767; // Excel's hard per-cell limit
const DATE_FORMAT = "yyyy-mm-dd hh:mm:ss";

function cellValue(v: unknown): ExcelJS.CellValue {
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : String(v);
  }
  if (typeof v === "boolean" || v instanceof Date) {
    return v;
  }
  if (typeof v === "string") {
    return v.slice(0, MAX_CELL_CHARS);
  }
  if (typeof v === "bigint") {
    return v.toString();
  }
  if (Buffer.isBuffer(v)) {
    return `0x${v.toString("hex")}`.slice(0, MAX_CELL_CHARS);
  }
  return JSON.stringify(v).slice(0, MAX_CELL_CHARS);
}

// Sized from the header and a sample of rows, clamped so one long text column
// can't push the rest off screen.
function columnWidth(column: string, rows: Record<string, unknown>[]): number {
  let max = column.length;
  for (const row of rows.slice(0, 200)) {
    const v = row[column];
    const len = v instanceof Date ? DATE_FORMAT.length : v == null ? 0 : String(v).length;
    max = Math.max(max, len);
  }
  return Math.min(Math.max(max + 2, 8), 60);
}

// One sheet per query that returned rows, plus a "Queries" sheet recording the
// SQL behind each one. Returns null when there is nothing worth attaching.
export async function buildReportWorkbook(exports: ReportExport[]): Promise<Buffer | null> {
  const withRows = exports.filter((e) => e.rows.length > 0);
  if (withRows.length === 0) {
    return null;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "slack-claude-code-bot";
  const index: Array<[string, number, number, string]> = [];

  withRows.forEach((e, i) => {
    const name = `Query ${i + 1}`;
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = e.columns.map((c) => ({ header: c, width: columnWidth(c, e.rows) }));
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: e.columns.length } };
    for (const row of e.rows) {
      const added = ws.addRow(e.columns.map((c) => cellValue(row[c])));
      added.eachCell((cell) => {
        if (cell.value instanceof Date) {
          cell.numFmt = DATE_FORMAT;
        }
      });
    }
    index.push([name, e.rowCount, e.rows.length, e.sql]);
  });

  const qs = wb.addWorksheet("Queries", { views: [{ state: "frozen", ySplit: 1 }] });
  qs.columns = [
    { header: "Sheet", width: 10 },
    { header: "Rows returned", width: 14 },
    { header: "Rows exported", width: 14 },
    { header: "SQL", width: 100 },
  ];
  qs.getRow(1).font = { bold: true };
  for (const [name, returned, exported, sql] of index) {
    qs.addRow([name, returned, exported, sql.slice(0, MAX_CELL_CHARS)]).alignment = { wrapText: true, vertical: "top" };
  }

  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

export function reportFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `report-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`;
}
