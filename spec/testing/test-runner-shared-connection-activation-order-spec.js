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
  const order = []

  class ObservedConfiguration extends Configuration {
    async ensureConnections(_args, callback) {
      order.push("connections")
      return await callback({})
    }
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
  it("loads testing configuration before test files", async () => {
    const order = []

    class ObservedEnvironmentHandler extends EnvironmentHandlerNode {
      async importTestingConfigPath() { order.push("testing config") }

      async importTestFiles() { order.push("test files") }
    }

    const environmentHandler = new ObservedEnvironmentHandler()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      testing: `${process.cwd()}/spec/dummy/src/config/testing.js`
    })
    const testRunner = new TestRunner({configuration, testFiles: ["example-spec.js"]})

    await testRunner.prepare()

    expect(order).toEqual(["testing config", "test files"])
  })

  it("runs afterEach hooks from the inner scope to the outer scope", async () => {
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
    const testRunner = new TestRunner({configuration, testFiles: []})
    const tests = {
      args: {},
      afterAlls: [],
      afterEaches: [
        {callback: async () => { order.push("framework cleanup") }},
        {callback: async () => { order.push("outer afterEach") }}
      ],
      beforeAlls: [],
      beforeEaches: [],
      subs: {
        nested: {
          args: {},
          afterAlls: [],
          afterEaches: [{callback: async () => { order.push("inner afterEach") }}],
          beforeAlls: [],
          beforeEaches: [],
          subs: {},
          tests: {
            "runs hooks": {
              args: {},
              function: async () => { order.push("test") }
            }
          }
        }
      },
      tests: {}
    }

    await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})
    await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})

    expect(order).toEqual([
      "test", "inner afterEach", "outer afterEach", "framework cleanup",
      "test", "inner afterEach", "outer afterEach", "framework cleanup"
    ])
  })

  it("runs framework afterEach cleanup and reports every hook failure", async () => {
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
    const testRunner = new TestRunner({configuration, testFiles: []})
    const tests = {
      args: {},
      afterAlls: [],
      afterEaches: [
        {callback: async () => {
          order.push("framework cleanup")
          throw new Error("expected framework cleanup failure")
        }},
        {callback: async () => {
          order.push("user afterEach")
          throw new Error("expected user cleanup failure")
        }}
      ],
      beforeAlls: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "fails during cleanup": {
          args: {},
          function: async () => {
            order.push("test")
            throw new Error("expected test body failure")
          }
        }
      }
    }

    await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})

    expect(order).toEqual(["test", "user afterEach", "framework cleanup"])
    expect(testRunner.getFailedTests()).toBe(1)
    const failure = testRunner.getFailedTestDetails()[0].error

    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.cause.message).toEqual("expected test body failure")
    expect(failure.errors[0].message).toEqual("expected test body failure")
    expect(failure.errors[1]).toBeInstanceOf(AggregateError)
    expect(failure.errors[1].errors.map((error) => error.message)).toEqual([
      "expected user cleanup failure",
      "expected framework cleanup failure"
    ])
  })

  it("does not activate dynamic providers for transaction-disabled non-request tests", async () => {
    const order = await transactionCoordinationOrder({databaseCleaning: {transaction: false, truncate: false}})

    expect(order).toEqual(["beforeEach", "test"])
  })

  it("installs transaction coordination before a transaction-opening hook exposes the shared connection", async () => {
    const order = await transactionCoordinationOrder({databaseCleaning: {transaction: true}})

    expect(order).toEqual(["connections", "activate", "coordinate", "beforeEach", "publish", "test"])
  })

  it("installs request coordination before a hook can open a manual transaction", async () => {
    const order = await transactionCoordinationOrder({
      databaseCleaning: {transaction: false, truncate: false},
      type: "request"
    })

    expect(order).toEqual(["connections", "activate", "coordinate", "beforeEach", "publish", "test"])
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
