// @ts-check

import PooledRunnerBrokerIdentity from "../../src/background-jobs/pooled-runner-broker-identity.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("Pooled runner broker identity", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("reserves an active user before admitting a different attempt capability", async () => {
    /** @type {() => void} */
    let releasePrepared = () => {}
    const preparedBlocked = new Promise((resolve) => { releasePrepared = resolve })
    /** @type {() => void} */
    let signalPrepared = () => {}
    const prepared = new Promise((resolve) => { signalPrepared = resolve })
    /** @type {() => void} */
    let releaseActive = () => {}
    const activeBlocked = new Promise((resolve) => { releaseActive = resolve })
    /** @type {() => void} */
    let signalActive = () => {}
    const active = new Promise((resolve) => { signalActive = resolve })

    class PausedAfterPrepareIdentity extends PooledRunnerBrokerIdentity {
      async prepare(config, options) {
        await super.prepare(config, options)
        if (config.capability === "attempt-b") {
          signalPrepared()
          await preparedBlocked
        }
      }
    }

    const identities = new PausedAfterPrepareIdentity({closeConnections: async () => {}})
    await identities.prepare({capability: "attempt-a", expected: true})
    const attemptB = identities.run({capability: "attempt-b", expected: true}, async () => {
      signalActive()
      await activeBlocked
    })
    await prepared
    const attemptC = identities.run({capability: "attempt-c", expected: true}, async () => {})

    await Promise.resolve()
    expect(identities.current()).toEqual(JSON.stringify({capability: "attempt-b", expected: true}))
    releasePrepared()
    await active
    await expect(async () => await attemptC).toThrow(/mix.*capabilit/i)
    releaseActive()
    await attemptB
  })

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

  it("admits same-capability callbacks concurrently while preparation is pending", async () => {
    /** @type {() => void} */
    let releaseClose = () => {}
    const closeBlocked = new Promise((resolve) => { releaseClose = resolve })
    /** @type {() => void} */
    let releaseCallbacks = () => {}
    const callbacksBlocked = new Promise((resolve) => { releaseCallbacks = resolve })
    let callbacksStarted = 0
    /** @type {() => void} */
    let signalBothCallbacks = () => {}
    const bothCallbacksStarted = new Promise((resolve) => { signalBothCallbacks = resolve })
    const identities = new PooledRunnerBrokerIdentity({closeConnections: async () => await closeBlocked})
    await identities.prepare({capability: "attempt-a", expected: true})
    const callback = async () => {
      callbacksStarted++
      if (callbacksStarted === 2) signalBothCallbacks()
      await callbacksBlocked
    }

    const first = identities.run({capability: "attempt-b", expected: true}, callback)
    const second = identities.run({capability: "attempt-b", expected: true}, callback)
    releaseClose()
    await bothCallbacksStarted

    expect(callbacksStarted).toEqual(2)
    releaseCallbacks()
    await Promise.all([first, second])
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
