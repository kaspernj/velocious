// @ts-check

import Configuration from "../../../../src/configuration.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

describe("Database - drivers - mssql transaction abort recovery", {tags: ["dummy"]}, () => {
  it("clears session state and recovers after SQL Server aborts a transaction", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      // Start a real transaction on the MSSQL connection.
      await db.startTransaction()
      expect(db._transactionsCount).toBe(1)
      expect(db._currentTransaction).not.toBeNull()

      // Force SQL Server to abort the transaction by raising a
      // severity-16 error with XACT_ABORT ON.  This kills the
      // transaction server-side, leaving the mssql.Transaction object
      // pointing at a dead transaction.
      try {
        await db.query("SET XACT_ABORT ON; RAISERROR('Intentional abort for test', 16, 1)")
      } catch {
        // Expected — the RAISERROR kills the batch.
      }

      // rollbackTransaction should clean up even though the SQL Server
      // transaction is already dead.  The _rollbackTransactionAction
      // catch block issues a raw IF @@TRANCOUNT > 0 ROLLBACK to clear
      // the session state.
      await db.rollbackTransaction()

      expect(db._currentTransaction).toBeNull()
      expect(db._transactionsCount).toBe(0)

      // The connection should be fully usable for a new transaction.
      await db.startTransaction()
      const result = await db.query("SELECT 1 AS recoveryCheck")

      expect(result[0].recoveryCheck).toBe(1)

      await db.rollbackTransaction()
      expect(db._transactionsCount).toBe(0)
    })
  })

  it("recovers and allows a full transaction cycle after abort", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.mssql

      if (!db || db.getType() !== "mssql") return

      // Create a temp table inside a transaction, abort it, then verify
      // we can do a complete transaction cycle on the same connection.
      await db.startTransaction()

      try {
        await db.query("SET XACT_ABORT ON; RAISERROR('Abort cycle test', 16, 1)")
      } catch {
        // Expected.
      }

      await db.rollbackTransaction()

      // Full transaction cycle: begin → query → commit on the same
      // connection that just had an aborted transaction.
      await db.startTransaction()
      await db.query("SELECT @@TRANCOUNT AS tranCount")
      await db.commitTransaction()

      expect(db._transactionsCount).toBe(0)
      expect(db._currentTransaction).toBeNull()
    })
  })
})
