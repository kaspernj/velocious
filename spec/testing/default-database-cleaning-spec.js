// @ts-check

import dummyConfiguration from "../dummy/src/config/configuration.js"
import {afterEach, describe, expect, it} from "../../src/testing/test.js"

describe("Default database cleaning", () => {
  afterEach(() => {
    const connection = dummyConfiguration.getDatabasePool("default").getCurrentConnection()

    expect(connection.insideTransaction()).toBe(true)
  })

  it("runs each test inside a transaction", () => {
    const connection = dummyConfiguration.getDatabasePool("default").getCurrentConnection()

    expect(connection.insideTransaction()).toBe(true)
  })
})
