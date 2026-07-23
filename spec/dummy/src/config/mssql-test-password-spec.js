// @ts-check

import {describe, expect, it} from "../../../../src/testing/test.js"

import mssqlTestPassword from "./mssql-test-password.js"

describe("MSSQL test password", () => {
  it("reads the required password from the test environment", () => {
    expect(mssqlTestPassword({MSSQL_SA_PASSWORD: "test-password"})).toEqual("test-password")
    expect(mssqlTestPassword({MSSQL_SA_PASSWORD: " test-password "})).toEqual(" test-password ")
  })

  it("rejects a missing or blank password", async () => {
    await expect(() => mssqlTestPassword({})).toThrow(/MSSQL_SA_PASSWORD/)
    await expect(() => mssqlTestPassword({MSSQL_SA_PASSWORD: "  "})).toThrow(/MSSQL_SA_PASSWORD/)
  })
})
