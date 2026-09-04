// @ts-check

import Application from "../../src/application.js"
import RequestClient from "../../src/testing/request-client.js"
import VelociousTestArguments from "../../src/testing/velocious-test-arguments.js"
import { describe, expect, it } from "../../src/testing/test.js"
import { buildTestingRunner } from "../helpers/testing-runner-parity.js"

describe("VelociousTestArguments", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("copies declaration arguments and injects only the framework-owned type arguments", async () => {
    const testRunner = buildTestingRunner()
    /** @type {Application} */
    const application = Object.create(Application.prototype)
    const client = new RequestClient()

    testRunner._application = application
    testRunner._requestClient = client

    const declarationArgs = {retry: 2, type: "request"}
    const testArguments = new VelociousTestArguments({testRunner})
    const requestArgs = await testArguments.build({args: declarationArgs, function: async () => {}})

    expect(requestArgs).not.toBe(declarationArgs)
    expect(requestArgs.retry).toBe(2)
    expect(requestArgs.application).toBe(application)
    expect(requestArgs.client).toBe(client)
    expect(declarationArgs).toEqual({retry: 2, type: "request"})

    const plainArgs = await testArguments.build({args: {type: "unit"}, function: async () => {}})

    expect(plainArgs.application).toBeUndefined()
    expect(plainArgs.client).toBeUndefined()
  })
})
