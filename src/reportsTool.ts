import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { queryReportsDb, type ReportsDbConfig, type ReportsQueryResult } from "./reportsDb.js";
import type { ReportExport } from "./reportExport.js";

// The model sees at most MODEL_ROWS rows per result, which keeps its context
// and the Slack reply sane. The full result, up to EXPORT_MAX_ROWS, goes to the
// Excel attachment via onResult.
export const MODEL_ROWS = 100;
export const EXPORT_MAX_ROWS = 50_000;

type QueryFn = (sql: string, cfg: ReportsDbConfig, maxRows: number) => Promise<ReportsQueryResult>;

export async function runReportsQuery(
  sql: string,
  cfg: ReportsDbConfig,
  onResult?: (e: ReportExport) => void,
  queryFn: QueryFn = queryReportsDb
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const r = await queryFn(sql, cfg, EXPORT_MAX_ROWS);
    onResult?.({ sql, ...r });
    const shown = r.rows.slice(0, MODEL_ROWS);
    const note = shown.length < r.rowCount ? ` (showing first ${shown.length} of ${r.rowCount})` : "";
    const attached =
      onResult && r.rows.length > 0
        ? `The full result${r.truncated ? ` (first ${r.rows.length} of ${r.rowCount} rows)` : ""} will be attached to the thread as an Excel file.\n`
        : "";
    return {
      content: [
        {
          type: "text",
          text:
            `Returned ${r.rowCount} row(s)${note}.\n` +
            attached +
            `Columns: ${r.columns.join(", ")}\n` +
            JSON.stringify(shown, null, 2),
        },
      ],
    };
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Query failed: ${err?.message ?? String(err)}` }],
      isError: true,
    };
  }
}

// In-process MCP server exposing a READ-ONLY query tool against the configured
// reporting database. A read-only DB login is the hard guarantee;
// assertReadOnlySql (in reportsDb) is the early guard. Build one per run so
// onResult only ever sees that run's queries.
export function createReportsMcpServer(
  cfg: ReportsDbConfig,
  onResult?: (e: ReportExport) => void
): unknown {
  return createSdkMcpServer({
    name: "reports",
    version: "1.0.0",
    tools: [
      tool(
        "query_reports_db",
        `Run a READ-ONLY SQL query against the configured reporting database (a read replica). Only a single SELECT / WITH / EXEC (stored procedure) statement is allowed — no writes. Use this to answer questions with real report data. You see at most the first ${MODEL_ROWS} rows; the full result is attached to the Slack thread as an Excel file.`,
        {
          sql: z.string().describe("A single read-only SELECT/WITH/EXEC statement"),
        },
        async (args) => runReportsQuery(args.sql, cfg, onResult)
      ),
    ],
  });
}
