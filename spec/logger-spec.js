// @ts-check

import {Logger} from "../src/logger.js"
import {describe, expect, it} from "../src/testing/test.js"

describe("Logger", async () => {
  it("separates subject and message with a space", async () => {
    /** @type {string[]} */
    const writes = []
    const originalWrite = process.stdout.write

    try {
      // @ts-ignore Monkey-patch to capture logger output
      process.stdout.write = (chunk, encoding, callback) => {
        writes.push(chunk.toString())
        if (typeof callback === "function") callback()
        return true
      }

      const logger = new Logger("PartnersEventsController")

      await logger.log("Processing by PartnersEventsController#show")
    } finally {
      // @ts-ignore Restore original stdout
      process.stdout.write = originalWrite
    }

    expect(writes[0]).toBe("PartnersEventsController Processing by PartnersEventsController#show\n")
  })
})
