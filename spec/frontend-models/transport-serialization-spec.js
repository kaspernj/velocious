// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "../../src/frontend-models/transport-serialization.js"

describe("Frontend models - transport serialization", () => {
  it("does not prototype-pollute during deserialize for __proto__ keys", () => {
    const payload = /** @type {Record<string, any>} */ (JSON.parse("{\"safe\":1,\"__proto__\":{\"polluted\":true}}"))

    try {
      const deserialized = /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(payload))

      expect(Object.prototype.polluted).toEqual(undefined)
      expect(Object.prototype.hasOwnProperty.call(deserialized, "__proto__")).toEqual(true)
      expect(deserialized["__proto__"].polluted).toEqual(true)
      expect(Object.getPrototypeOf(deserialized)).toEqual(null)
    } finally {
      delete Object.prototype.polluted
    }
  })

  it("does not prototype-pollute during serialize for __proto__ keys", () => {
    const payload = /** @type {Record<string, any>} */ (JSON.parse("{\"safe\":1,\"__proto__\":{\"polluted\":true}}"))

    try {
      const serialized = /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue(payload))

      expect(Object.prototype.polluted).toEqual(undefined)
      expect(Object.prototype.hasOwnProperty.call(serialized, "__proto__")).toEqual(true)
      expect(serialized["__proto__"].polluted).toEqual(true)
      expect(Object.getPrototypeOf(serialized)).toEqual(null)
    } finally {
      delete Object.prototype.polluted
    }
  })
})
