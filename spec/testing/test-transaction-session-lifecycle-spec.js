// @ts-check

import TestTransactionSession from "../../src/testing/test-transaction-session.js"
import SharedTransactionBrokerClient from "../../src/testing/shared-transaction-broker-client.js"

class SessionConnection {
  constructor() {
    this.calls = []
    /** @type {() => void} */
    this.releaseQuery = () => {}
    /** @type {(value?: void) => void} */
    this.resolveQueryStarted = () => {}
    this.queryStarted = new Promise((resolve) => { this.resolveQueryStarted = resolve })
  }

  async startTransaction() { this.calls.push("begin") }
  async query(sql) {
    this.calls.push(sql)
    if (sql === "held") {
      this.resolveQueryStarted()
      await new Promise((resolve) => { this.releaseQuery = resolve })
    }
    return []
  }
  async rollbackTransaction() { this.calls.push("rollback") }
}

describe("Test transaction session lifecycle", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("drains accepted work, rejects work after revocation starts, and rolls back each enrollment once", async () => {
    const connection = new SessionConnection()
    let releases = 0
    const session = await TestTransactionSession.begin()
    await session.enroll({
      connection,
      databaseIdentifier: "projectTenant",
      release: async () => { releases++ },
      reuseKey: "tenant-alpha"
    })
    const controlMessage = session.joinMessage()
    const client = new SharedTransactionBrokerClient({...controlMessage, databaseIdentifier: "projectTenant", reuseKey: "tenant-alpha"})

    const heldWork = client.call("query", ["held"])
    await connection.queryStarted
    const cleanup = session.cleanup()
    await expect(() => client.call("query", ["late"])).toThrow(/revoked/i)
    expect(connection.calls).toEqual(["begin", "held"])
    connection.releaseQuery()
    await heldWork
    await cleanup
    await session.cleanup()

    expect(connection.calls).toEqual(["begin", "held", "rollback"])
    expect(releases).toEqual(1)
    expect(controlMessage.capability).toBeDefined()
    expect(JSON.stringify(session.debugSnapshot())).not.toMatch(controlMessage.capability)
    await client.close()
  })
})
