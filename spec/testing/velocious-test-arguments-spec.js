// @ts-check

import {createTestContext} from "@velocious/testing"
import Application from "../../src/application.js"
import RequestClient from "../../src/testing/request-client.js"
import VelociousTestArguments from "../../src/testing/velocious-test-arguments.js"
import { describe, expect, it } from "../../src/testing/test.js"
import { buildTestingRunner } from "../helpers/testing-runner-parity.js"

describe("VelociousTestArguments", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("caches declaration arguments and injects only framework-owned collaborators", async () => {
    const context = createTestContext()
    const testRunner = buildTestingRunner({context})
    /** @type {Application} */
    const application = Object.create(Application.prototype)
    const client = new RequestClient()

    testRunner._application = application
    testRunner._requestClient = client
    context.describe("arguments", () => {
      context.it("request", {retry: 2, type: "request"}, () => {})
      context.it("plain", {type: "unit"}, () => {})
    })
    testRunner.analyzeDeclarations()
    const [requestTest, plainTest] = context.registry.suites[0].tests
    const testArguments = new VelociousTestArguments({testRunner})
    const requestArgs = await testArguments.resolve({context, suite: context.registry.suites[0], test: requestTest, attemptNumber: 1})
    const retriedArgs = await testArguments.resolve({context, suite: context.registry.suites[0], test: requestTest, attemptNumber: 2})
    const plainArgs = await testArguments.resolve({context, suite: context.registry.suites[0], test: plainTest, attemptNumber: 1})

    expect(requestArgs.length).toBe(1)
    expect(requestArgs[0].retry).toBe(2)
    expect(requestArgs[0].application).toBe(application)
    expect(requestArgs[0].client).toBe(client)
    expect(retriedArgs[0]).toBe(requestArgs[0])
    expect(plainArgs[0].application).toBeUndefined()
    expect(plainArgs[0].client).toBeUndefined()
  })
})
