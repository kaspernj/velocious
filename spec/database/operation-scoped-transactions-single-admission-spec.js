// @ts-check

import Configuration from "../../src/configuration.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"

describe("database - operation-scoped transactions - SingleMultiUsePool admission", {tags: ["dummy"], databaseCleaning: {transaction: false}}, () => {
  it("rejects admission while an unrelated ordinary transaction owns the connection", async () => {
    const configuration = Configuration.current()
    const pool = new SingleMultiUsePool({configuration, identifier: "default"})
    let rejectedOperationError
    let rejectedOperationCallbackRuns = 0
    let rejectedOperationAfterCommitRuns = 0

    try {
      await pool.withConnection({name: "held ordinary transaction"}, async (connection) => {
        await expect(async () => {
          await connection.transaction(async () => {
            try {
              await pool.withOperationConnection({name: "rejected operation"}, async () => {
                rejectedOperationCallbackRuns++
              })
            } catch (error) {
              rejectedOperationError = error
            }

            await connection.afterCommit(() => {
              rejectedOperationAfterCommitRuns++
            })

            throw new Error("ROLLBACK_HELD_ORDINARY_TRANSACTION")
          })
        }).toThrowError("ROLLBACK_HELD_ORDINARY_TRANSACTION")
      })

      expect(rejectedOperationError instanceof Error ? rejectedOperationError.message : undefined).toContain("ordinary transaction is already active")
      expect(rejectedOperationCallbackRuns).toEqual(0)
      expect(rejectedOperationAfterCommitRuns).toEqual(0)

      let survivingOperationRuns = 0
      let survivingAfterCommitRuns = 0

      await pool.withOperationConnection({name: "operation after rollback"}, async (connection, owner) => {
        await connection.transaction(async () => {
          survivingOperationRuns++
          await connection.afterCommit(() => {
            survivingAfterCommitRuns++
          }, {operationOwner: owner})
        }, {operationOwner: owner})
      })

      expect(survivingOperationRuns).toEqual(1)
      expect(survivingAfterCommitRuns).toEqual(1)
    } finally {
      await pool.closeAll()
    }
  })
})
