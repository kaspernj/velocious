// @ts-check

import PooledRunnerBrokerIdentity from "../../src/background-jobs/pooled-runner-broker-identity.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("Pooled runner broker identity", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("shares one pending rotation between concurrent jobs requesting the same identity", async () => {
    /** @type {() => void} */
    let releaseClose = () => {}
    const closeBlocked = new Promise((resolve) => { releaseClose = resolve })
    let closeCalls = 0
    const identities = new PooledRunnerBrokerIdentity({closeConnections: async () => {
      closeCalls++
      await closeBlocked
    }})
    await identities.prepare({capability: "attempt-a", expected: true})

    const first = identities.prepare({capability: "attempt-b", expected: true})
    const second = identities.prepare({capability: "attempt-b", expected: true})
    await Promise.resolve()
    expect(closeCalls).toEqual(1)
    releaseClose()
    await Promise.all([first, second])

    expect(identities.current()).toEqual(JSON.stringify({capability: "attempt-b", expected: true}))
  })

  it("rejects a truly different identity while a rotation is pending", async () => {
    /** @type {() => void} */
    let releaseClose = () => {}
    const closeBlocked = new Promise((resolve) => { releaseClose = resolve })
    const identities = new PooledRunnerBrokerIdentity({closeConnections: async () => await closeBlocked})
    await identities.prepare({capability: "attempt-a", expected: true})

    const pending = identities.prepare({capability: "attempt-b", expected: true})
    await expect(() => identities.prepare({capability: "attempt-c", expected: true})).toThrow(/mix.*capabilit/i)
    releaseClose()
    await pending
  })
})
