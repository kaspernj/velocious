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

      // rollbackTransaction uses a raw IF @@TRANCOUNT > 0 ROLLBACK
      // which handles both alive and already-dead transactions.
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

      // Abort a transaction.
      await db.startTransaction()

      try {
        await db.query("SET XACT_ABORT ON; RAISERROR('Abort for cycle test', 16, 1)")
      } catch {
        // Expected.
      }

      await db.rollbackTransaction()

      // Full cycle on the recovered connection.
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

      // Verify connection is still usable.
      const result = await db.query("SELECT 2 AS afterRollback")

      expect(result[0].afterRollback).toBe(2)
    })
  })

  it("handles the transaction() helper recovering from an error inside the callback", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      // The transaction() helper starts a transaction, runs the
      // callback, and rolls back on error.  After recovery the
      // connection should be clean and usable.
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
})
