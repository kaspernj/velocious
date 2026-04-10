// @ts-check

import Configuration from "../../../../src/configuration.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

describe("Database - drivers - mssql transaction abort recovery", {tags: ["dummy"]}, () => {
  it("recovers after SQL Server aborts a transaction via XACT_ABORT", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      await db.startTransaction()

      try {
        await db.query("SET XACT_ABORT ON; RAISERROR('Intentional abort', 16, 1)")
      } catch {
        // Expected — RAISERROR kills the batch and aborts the transaction.
      }

      await db.rollbackTransaction()

      expect(db._currentTransaction).toBeNull()
      expect(db._transactionsCount).toBe(0)

      // Connection should be fully usable for new work.
      const result = await db.query("SELECT 1 AS recoveryCheck")

      expect(result[0].recoveryCheck).toBe(1)
    })
  })

  it("allows a full begin-query-commit cycle after an aborted transaction", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      await db.startTransaction()

      try {
        await db.query("SET XACT_ABORT ON; RAISERROR('Abort for cycle test', 16, 1)")
      } catch {
        // Expected.
      }

      await db.rollbackTransaction()

      // Full begin → query → commit cycle on the recovered connection.
      await db.startTransaction()
      await db.query("SELECT @@TRANCOUNT AS tranCount")
      await db.commitTransaction()

      expect(db._transactionsCount).toBe(0)
      expect(db._currentTransaction).toBeNull()
    })
  })

  it("handles a normal rollback (no abort) correctly", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      await db.startTransaction()
      await db.query("SELECT 1 AS alive")
      await db.rollbackTransaction()

      expect(db._transactionsCount).toBe(0)
      expect(db._currentTransaction).toBeNull()

      const result = await db.query("SELECT 2 AS afterRollback")

      expect(result[0].afterRollback).toBe(2)
    })
  })

  it("recovers when the transaction() helper callback throws", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      try {
        await db.transaction(async () => {
          throw new Error("Intentional error inside transaction")
        })
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }

      expect(db._transactionsCount).toBe(0)
      expect(db._currentTransaction).toBeNull()

      // Connection should still work for a new transaction.
      await db.transaction(async () => {
        const result = await db.query("SELECT 3 AS afterRecovery")

        expect(result[0].afterRecovery).toBe(3)
      })
    })
  })

  it("recovers when a query inside the transaction() helper triggers XACT_ABORT", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      try {
        await db.transaction(async () => {
          await db.query("SET XACT_ABORT ON; RAISERROR('XACT_ABORT inside transaction()', 16, 1)")
        })
      } catch {
        // Expected — the RAISERROR aborts the transaction, transaction()
        // catches the callback error and calls rollbackTransaction().
      }

      expect(db._transactionsCount).toBe(0)
      expect(db._currentTransaction).toBeNull()

      // Verify the connection is usable for a new full cycle.
      await db.transaction(async () => {
        const result = await db.query("SELECT 4 AS xactAbortRecovery")

        expect(result[0].xactAbortRecovery).toBe(4)
      })
    })
  })

  it("recovers after a duplicate key violation aborts the transaction", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      // Create a real table (not a temp table — temp tables are
      // session-scoped and transaction() may use a different connection
      // for the inner ensureConnections call).
      await db.query("IF OBJECT_ID('velocious_dupkey_test', 'U') IS NOT NULL DROP TABLE velocious_dupkey_test")
      await db.query("CREATE TABLE velocious_dupkey_test (id INT PRIMARY KEY)")

      try {
        await db.startTransaction()
        await db.query("INSERT INTO velocious_dupkey_test (id) VALUES (1)")
        // This duplicate insert triggers a PK violation.  With
        // XACT_ABORT ON the entire transaction is aborted server-side.
        await db.query("SET XACT_ABORT ON; INSERT INTO velocious_dupkey_test (id) VALUES (1)")
      } catch (error) {
        expect(error).toBeInstanceOf(Error)

        if (error instanceof Error) {
          expect(error.message).toContain("Violation of PRIMARY KEY constraint")
        }
      }

      await db.rollbackTransaction()

      // Reset XACT_ABORT so it doesn't affect subsequent tests.
      await db.query("SET XACT_ABORT OFF")

      expect(db._transactionsCount).toBe(0)
      expect(db._currentTransaction).toBeNull()

      // Connection should be fully usable for new work.
      const result = await db.query("SELECT 5 AS afterDupKey")

      expect(result[0].afterDupKey).toBe(5)

      // Clean up.
      await db.query("DROP TABLE velocious_dupkey_test")
    })
  })

  it("rolls back a nested savepoint without affecting the outer transaction", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      await db.query("IF OBJECT_ID('velocious_nested_test', 'U') IS NOT NULL DROP TABLE velocious_nested_test")
      await db.query("CREATE TABLE velocious_nested_test (id INT PRIMARY KEY, val VARCHAR(20))")

      // Outer transaction inserts row 1, inner (nested) transaction
      // inserts row 2 then rolls back — only row 1 should survive.
      await db.transaction(async () => {
        await db.query("INSERT INTO velocious_nested_test (id, val) VALUES (1, 'outer')")

        try {
          await db.transaction(async () => {
            await db.query("INSERT INTO velocious_nested_test (id, val) VALUES (2, 'inner')")
            throw new Error("Intentional inner rollback")
          })
        } catch (error) {
          if (error instanceof Error) {
            expect(error.message).toEqual("Intentional inner rollback")
          }
        }
      })

      const rows = await db.query("SELECT id, val FROM velocious_nested_test ORDER BY id")

      expect(rows.length).toBe(1)
      expect(rows[0].id).toBe(1)
      expect(rows[0].val).toEqual("outer")

      await db.query("DROP TABLE velocious_nested_test")
    })
  })

  it("recovers when XACT_ABORT kills the outer transaction from inside a nested transaction", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      // XACT_ABORT inside a nested transaction kills the entire
      // transaction (not just the savepoint).  The outer transaction()
      // helper's catch block calls rollbackTransaction() which must
      // handle the dead-transaction state.
      try {
        await db.transaction(async () => {
          await db.transaction(async () => {
            await db.query("SET XACT_ABORT ON; RAISERROR('Nested abort', 16, 1)")
          })
        })
      } catch {
        // Expected.
      }

      await db.query("SET XACT_ABORT OFF")

      expect(db._transactionsCount).toBe(0)
      expect(db._currentTransaction).toBeNull()

      // Connection should be usable for a new transaction.
      await db.transaction(async () => {
        const result = await db.query("SELECT 7 AS nestedAbortRecovery")

        expect(result[0].nestedAbortRecovery).toBe(7)
      })
    })
  })

  it("recovers when a duplicate key in a nested transaction aborts everything", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      await db.query("IF OBJECT_ID('velocious_nested_dup', 'U') IS NOT NULL DROP TABLE velocious_nested_dup")
      await db.query("CREATE TABLE velocious_nested_dup (id INT PRIMARY KEY)")

      try {
        await db.transaction(async () => {
          await db.query("INSERT INTO velocious_nested_dup (id) VALUES (1)")

          await db.transaction(async () => {
            await db.query("SET XACT_ABORT ON; INSERT INTO velocious_nested_dup (id) VALUES (1)")
          })
        })
      } catch {
        // Expected — XACT_ABORT kills the entire transaction.
        // The error that propagates may be the original PK violation
        // or the savepoint-rollback failure, depending on how the
        // base driver's catch block handles it.
      }

      await db.query("SET XACT_ABORT OFF")

      expect(db._transactionsCount).toBe(0)
      expect(db._currentTransaction).toBeNull()

      // The duplicate-key insert was rolled back, so the table should
      // be empty (the outer transaction was also killed).
      const rows = await db.query("SELECT COUNT(*) AS cnt FROM velocious_nested_dup")

      expect(rows[0].cnt).toBe(0)

      await db.query("DROP TABLE velocious_nested_dup")
    })
  })

  it("allows multiple abort-and-recover cycles on the same connection", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      // Run two abort-recover cycles to verify the connection doesn't
      // accumulate residual state across multiple recoveries.
      for (let cycle = 1; cycle <= 3; cycle++) {
        await db.startTransaction()

        try {
          await db.query("SET XACT_ABORT ON; RAISERROR('Cycle abort', 16, 1)")
        } catch {
          // Expected.
        }

        await db.rollbackTransaction()
        await db.query("SET XACT_ABORT OFF")

        expect(db._transactionsCount).toBe(0)
        expect(db._currentTransaction).toBeNull()
      }

      // After three cycles the connection should still work.
      const result = await db.query("SELECT 6 AS afterCycles")

      expect(result[0].afterCycles).toBe(6)
    })
  })
})
