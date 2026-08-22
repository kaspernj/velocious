// @ts-check

import SharedTransactionBrokerClient from "../../src/testing/shared-transaction-broker-client.js"

if (!process.send) throw new Error("Test transaction backend child requires IPC")

process.send({type: "ready"})
process.on("message", (message) => {
  void handleMessage(message)
})

/** @param {ReturnType<typeof JSON.parse>} message - Live parent control message. */
async function handleMessage(message) {
  if (!message || message.type !== "join") return
  const client = new SharedTransactionBrokerClient({
    address: message.session.address,
    capability: message.session.capability,
    databaseIdentifier: message.databaseIdentifier,
    reuseKey: message.reuseKey
  })
  try {
    await client.call("query", [message.sql])
    process.send?.({type: "completed"})
  } catch (error) {
    process.send?.({type: "failed", message: error instanceof Error ? error.message : String(error)})
  } finally {
    await client.close()
  }
}
