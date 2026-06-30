import { describe, it, expect } from "vitest";
import { assertReadOnlySql } from "../src/reportsDb.js";

describe("assertReadOnlySql", () => {
  it("allows a single SELECT", () => {
    expect(() => assertReadOnlySql("SELECT TOP 10 * FROM Agents")).not.toThrow();
  });
  it("allows WITH and EXEC of a report proc", () => {
    expect(() => assertReadOnlySql("WITH x AS (SELECT 1 a) SELECT * FROM x")).not.toThrow();
    expect(() => assertReadOnlySql("EXEC usp_GetSalesSummary @userId=1")).not.toThrow();
    expect(() => assertReadOnlySql("SELECT 1;")).not.toThrow(); // one trailing ; ok
  });
  it("rejects writes", () => {
    expect(() => assertReadOnlySql("DELETE FROM Agents")).toThrow();
    expect(() => assertReadOnlySql("UPDATE Agents SET x=1")).toThrow();
    expect(() => assertReadOnlySql("DROP TABLE Agents")).toThrow();
    expect(() => assertReadOnlySql("TRUNCATE TABLE Agents")).toThrow();
  });
  it("rejects multi-statement / stacked injection", () => {
    expect(() => assertReadOnlySql("SELECT 1; DROP TABLE Agents")).toThrow(/single statement/i);
  });
  it("rejects non-read leading keyword", () => {
    expect(() => assertReadOnlySql("EXEC xp_cmdshell 'dir'")).toThrow();
    expect(() => assertReadOnlySql("INSERT INTO x VALUES (1)")).toThrow();
  });
});
