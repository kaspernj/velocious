// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {buildTestingRunner, runTestingScope, testingScope} from "../helpers/testing-runner-parity.js"

describe("TestRunner retry", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("retries a failing test until it succeeds", async () => {
    const testRunner = buildTestingRunner()

    let attempts = 0
    const tests = {
      args: {},
      afterEaches: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "retries until it passes": {
          args: {retry: 2},
          function: async () => {
            attempts++

            if (attempts < 3) {
              throw new Error("flaky")
            }
          }
        }
      }
    }

    await runTestingScope(testRunner, testingScope(tests))

    expect(attempts).toBe(3)
    expect(testRunner.getSuccessfulTests()).toBe(1)
    expect(testRunner.getFailedTests()).toBe(0)
  })

  it("normalizes invalid retry counts to zero", async () => {
    const testRunner = buildTestingRunner()
    const attempts = {infinite: 0, nan: 0, negative: 0}
    const tests = {
      args: {},
      afterEaches: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "does not retry a negative count": {
          args: {retry: -1},
          function: async () => {
            attempts.negative++
            throw new Error("negative retry")
          }
        },
        "does not retry a NaN count": {
          args: {retry: Number.NaN},
          function: async () => {
            attempts.nan++
            throw new Error("NaN retry")
          }
        },
        "does not retry an infinite count": {
          args: {retry: Number.POSITIVE_INFINITY},
          function: async () => {
            attempts.infinite++

            if (attempts.infinite === 1) throw new Error("infinite retry")
          }
        }
      }
    }

    await runTestingScope(testRunner, testingScope(tests))

    expect(attempts).toEqual({infinite: 1, nan: 1, negative: 1})
    expect(testRunner.getSuccessfulTests()).toBe(0)
    expect(testRunner.getFailedTests()).toBe(3)
  })
})
