import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { queryReportsDb, type ReportsDbConfig } from "./reportsDb.js";

// In-process MCP server exposing a READ-ONLY query tool against the configured
// reporting database. A read-only DB login is the hard guarantee;
// assertReadOnlySql (in reportsDb) is the early guard. Results are capped to
// keep Slack replies sane.
export function createReportsMcpServer(cfg: ReportsDbConfig): unknown {
  return createSdkMcpServer({
    name: "reports",
    version: "1.0.0",
    tools: [
      tool(
        "query_reports_db",
        "Run a READ-ONLY SQL query against the configured reporting database (a read replica). Only a single SELECT / WITH / EXEC (stored procedure) statement is allowed — no writes. Use this to answer questions with real report data. Results are capped to 100 rows.",
        {
          sql: z.string().describe("A single read-only SELECT/WITH/EXEC statement"),
        },
        async (args) => {
          try {
            const r = await queryReportsDb(args.sql, cfg, 100);
            const note = r.truncated ? ` (showing first 100 of ${r.rowCount})` : "";
            return {
              content: [
                {
                  type: "text",
                  text:
                    `Returned ${r.rowCount} row(s)${note}.\n` +
                    `Columns: ${r.columns.join(", ")}\n` +
                    JSON.stringify(r.rows, null, 2),
                },
              ],
            };
          } catch (err: any) {
            return {
              content: [
                { type: "text", text: `Query failed: ${err?.message ?? String(err)}` },
              ],
              isError: true,
            };
          }
        }
      ),
    ],
  });
}
