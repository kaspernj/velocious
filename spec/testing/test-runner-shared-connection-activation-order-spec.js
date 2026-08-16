// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

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
        "coordinates a transaction test": {
          args: {databaseCleaning: {transaction: true}},
          function: async () => { order.push("test") }
        }
      }
    }

    await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})

    expect(order).toEqual(["activate", "coordinate", "beforeEach", "publish", "test"])
  })
})
