// @ts-check

import Application from "../../src/application.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"
import RequestClient from "../../src/testing/request-client.js"
import TestRunner from "../../src/testing/test-runner.js"

/**
 * Runs one observed lifecycle that should prepare transaction coordination before its hook.
 * @param {{databaseCleaning: {transaction: boolean, truncate?: boolean}, type?: "request"}} testArgs - Lifecycle options.
 * @returns {Promise<string[]>} - Observed lifecycle order.
 */
async function transactionCoordinationOrder(testArgs) {
  const configuration = new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
  const order = []

  class ObservedTestRunner extends TestRunner {
    async application() {
      return new Application({configuration, type: "test-runner-observation"})
    }

    async requestClient() {
      return new RequestClient()
    }

    activateTestSharedConnections() {
      order.push("activate")
      return []
    }

    async prepareSharedTransactionBroker() {
      order.push("coordinate")
      return undefined
    }

    async startSharedTransactionBroker() {
      order.push("publish")
      return undefined
    }
  }

  const testRunner = new ObservedTestRunner({configuration, testFiles: []})
  const tests = {
    args: {},
    afterAlls: [],
    afterEaches: [],
    beforeAlls: [],
    beforeEaches: [{callback: async () => { order.push("beforeEach") }}],
    subs: {},
    tests: {
      "coordinates before the hook": {
        args: testArgs,
        function: async () => { order.push("test") }
      }
    }
  }

  await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})

  return order
}

describe("TestRunner shared connection activation order", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("activates dynamic providers before non-request beforeEach hooks", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const order = []

    class ObservedTestRunner extends TestRunner {
      activateTestSharedConnections() {
        order.push("activate")
        return []
      }

      async startSharedTransactionBroker() {
        order.push("broker")
        return undefined
      }
    }

    const testRunner = new ObservedTestRunner({configuration, testFiles: []})
    const tests = {
      args: {},
      afterAlls: [],
      afterEaches: [],
      beforeAlls: [],
      beforeEaches: [{callback: async () => { order.push("beforeEach") }}],
      subs: {},
      tests: {
        "runs outside request mode": {
          args: {},
          function: async () => { order.push("test") }
        }
      }
    }

    await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})

    expect(order[0]).toEqual("activate")
  })

  it("installs transaction coordination before a transaction-opening hook exposes the shared connection", async () => {
    const order = await transactionCoordinationOrder({databaseCleaning: {transaction: true}})

    expect(order).toEqual(["activate", "coordinate", "beforeEach", "publish", "test"])
  })

  it("installs request coordination before a hook can open a manual transaction", async () => {
    const order = await transactionCoordinationOrder({
      databaseCleaning: {transaction: false, truncate: false},
      type: "request"
    })

    expect(order).toEqual(["activate", "coordinate", "beforeEach", "publish", "test"])
  })

  it("revokes shared access before broker shutdown and transaction cleanup", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const order = []

    class ObservedTestRunner extends TestRunner {
      activateTestSharedConnections() {
        order.push("activate")
        return []
      }

      clearTestSharedConnections() { order.push("clear") }

      async prepareSharedTransactionBroker() {
        order.push("coordinate")
        return undefined
      }

      async startSharedTransactionBroker() {
        order.push("publish")
        return undefined
      }

      async stopSharedTransactionBroker() { order.push("stop") }
    }

    const testRunner = new ObservedTestRunner({configuration, testFiles: []})
    const tests = {
      args: {},
      afterAlls: [],
      afterEaches: [{callback: async () => { order.push("afterEach") }}],
      beforeAlls: [],
      beforeEaches: [{callback: async () => { order.push("beforeEach") }}],
      subs: {},
      tests: {
        "coordinates cleanup": {
          args: {databaseCleaning: {transaction: true}},
          function: async () => { order.push("test") }
        }
      }
    }

    await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})

    expect(order).toEqual(["activate", "coordinate", "beforeEach", "publish", "test", "clear", "stop", "afterEach"])
  })

  it("drains pending broadcasts before revoking shared access and transaction cleanup", async () => {
    const order = []

    class ObservedConfiguration extends Configuration {
      async awaitPendingBroadcasts() { order.push("awaitPendingBroadcasts") }
    }

    const configuration = new ObservedConfiguration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    class ObservedTestRunner extends TestRunner {
      activateTestSharedConnections() {
        order.push("activate")
        return []
      }

      clearTestSharedConnections() { order.push("clear") }

      async prepareSharedTransactionBroker() {
        order.push("coordinate")
        return undefined
      }

      async startSharedTransactionBroker() {
        order.push("publish")
        return undefined
      }

      async stopSharedTransactionBroker() { order.push("stop") }
    }

    const testRunner = new ObservedTestRunner({configuration, testFiles: []})
    const tests = {
      args: {},
      afterAlls: [],
      afterEaches: [{callback: async () => { order.push("afterEach") }}],
      beforeAlls: [],
      beforeEaches: [{callback: async () => { order.push("beforeEach") }}],
      subs: {},
      tests: {
        "coordinates pending broadcast cleanup": {
          args: {databaseCleaning: {transaction: true}},
          function: async () => { order.push("test") }
        }
      }
    }

    await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})

    expect(order).toEqual(["activate", "coordinate", "beforeEach", "publish", "test", "awaitPendingBroadcasts", "clear", "stop", "afterEach"])
  })
})
