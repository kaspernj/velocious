// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {sanitizeAdapterValue} from "../../src/deployment-api/sanitize.js"

const TOKEN = "secret-token"

describe("Deployment API - adapter value sanitization", () => {
  it("redacts nested object keys and deterministically preserves colliding values", () => {
    const sanitized = /** @type {Record<string, ?>} */ (sanitizeAdapterValue({
      "credential-[redacted]": "literal-redacted-key",
      [`credential-${TOKEN}`]: "secret-bearing-key",
      nested: {[`nested-${TOKEN}`]: "nested-value"}
    }, [TOKEN]))
    const nested = /** @type {Record<string, ?>} */ (sanitized.nested)

    expect(JSON.stringify(sanitized)).not.toContain(TOKEN)
    expect(Object.keys(sanitized)).toEqual(["credential-[redacted]", "credential-[redacted]#2", "nested"])
    expect(sanitized["credential-[redacted]"]).toEqual("literal-redacted-key")
    expect(sanitized["credential-[redacted]#2"]).toEqual("secret-bearing-key")
    expect(nested).toEqual({"nested-[redacted]": "nested-value"})
  })
})
