import sql from "mssql";

export interface ReportsDbConfig {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface ReportsQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

// Defence in depth on top of the read-only login: only allow a single SELECT /
// WITH / EXEC statement; reject anything that could mutate. The DB reader login
// is the real guarantee — this just stops obvious accidents/injection early.
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|merge|grant|revoke|deny|backup|restore|shutdown|reconfigure|waitfor)\b|\b(xp_|sp_)\w+/i;

export function assertReadOnlySql(rawSql: string): void {
  const s = rawSql.trim().replace(/;+\s*$/, ""); // allow one trailing semicolon
  if (!s) {
    throw new Error("Empty query.");
  }
  if (s.includes(";")) {
    throw new Error("Only a single statement is allowed (no ';' in the middle).");
  }
  if (!/^(select|with|exec(ute)?)\b/i.test(s)) {
    throw new Error("Only SELECT / WITH / EXEC (stored-procedure) queries are allowed.");
  }
  if (FORBIDDEN.test(s)) {
    throw new Error("Query contains a disallowed (non-read) keyword.");
  }
}

let poolPromise: Promise<sql.ConnectionPool> | null = null;

function getPool(cfg: ReportsDbConfig): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool({
      server: cfg.server,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      options: {
        encrypt: true,
        trustServerCertificate: true,
        readOnlyIntent: true,
      },
      requestTimeout: 20000,
      connectionTimeout: 15000,
      pool: { max: 2, min: 0, idleTimeoutMillis: 30000 },
    })
      .connect()
      .catch((err: unknown) => {
        poolPromise = null; // allow retry on next call
        throw err;
      });
  }
  return poolPromise!;
}

export async function queryReportsDb(
  rawSql: string,
  cfg: ReportsDbConfig,
  maxRows = 100
): Promise<ReportsQueryResult> {
  assertReadOnlySql(rawSql);
  const pool = await getPool(cfg);
  const result = await pool.request().query(rawSql);
  const all = (result.recordset ?? []) as Record<string, unknown>[];
  const rows = all.slice(0, maxRows);
  const columns = all.length > 0 ? Object.keys(all[0]) : [];
  return {
    columns,
    rows,
    rowCount: all.length,
    truncated: all.length > maxRows,
  };
}
