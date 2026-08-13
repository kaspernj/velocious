// @ts-check

import { decodeBrokerValue, encodeBrokerValue } from "../../src/testing/shared-transaction-codec.js"

describe("Shared transaction broker codec", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("round trips database values without JSON coercion", () => {
    const original = {
      bigint: 9007199254740993n,
      buffer: Buffer.from([0, 1, 2, 255]),
      date: new Date("2026-08-12T10:20:30.456Z"),
      infinity: Infinity,
      nan: NaN,
      negativeInfinity: -Infinity,
      nested: [undefined, {value: undefined}],
      undefined
    }

    const decoded = decodeBrokerValue(encodeBrokerValue(original))

    expect(decoded.bigint).toEqual(original.bigint)
    expect(Array.from(decoded.buffer)).toEqual(Array.from(original.buffer))
    expect(decoded.date.toISOString()).toEqual(original.date.toISOString())
    expect(decoded.infinity).toEqual(Infinity)
    expect(Number.isNaN(decoded.nan)).toEqual(true)
    expect(decoded.negativeInfinity).toEqual(-Infinity)
    expect(decoded.nested).toEqual(original.nested)
    expect(Object.hasOwn(decoded, "undefined")).toEqual(true)
    expect(decoded.undefined).toEqual(undefined)
  })

  it("round trips driver error identity and causes", () => {
    const cause = new TypeError("socket closed")
    cause.code = "ECONNRESET"
    const error = new Error("query failed", {cause})
    error.name = "DatabaseError"
    error.code = "EREQUEST"

    const decoded = decodeBrokerValue(encodeBrokerValue(error))

    expect(decoded).toBeInstanceOf(Error)
    expect(decoded.name).toEqual("DatabaseError")
    expect(decoded.message).toEqual("query failed")
    expect(decoded.code).toEqual("EREQUEST")
    expect(decoded.stack).toEqual(error.stack)
    expect(decoded.cause).toBeInstanceOf(TypeError)
    expect(decoded.cause.message).toEqual("socket closed")
    expect(decoded.cause.code).toEqual("ECONNRESET")
  })
})
