// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import fetch from "node-fetch"

import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

describe("HttpServer - request timeout", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  it("times out requests using the configured timeout", async () => {
    const originalTimeoutEnv = process.env.VELOCIOUS_REQUEST_TIMEOUT_MS
    process.env.VELOCIOUS_REQUEST_TIMEOUT_MS = "0.05"

    try {
      await Dummy.run(async () => {
        expect(dummyConfiguration.getRequestTimeoutMs()).toEqual(0.05)
        const response = await fetch("http://localhost:3006/slow?waitSeconds=0.2")
        const body = await response.text()

        expect(response.status).toEqual(500)
        expect(body).toContain("Request timed out after 0.05s")
      })
    } finally {
      if (originalTimeoutEnv === undefined) {
        delete process.env.VELOCIOUS_REQUEST_TIMEOUT_MS
      } else {
        process.env.VELOCIOUS_REQUEST_TIMEOUT_MS = originalTimeoutEnv
      }
    }
  })

  it("allows controller actions to override the timeout", async () => {
    const originalTimeoutEnv = process.env.VELOCIOUS_REQUEST_TIMEOUT_MS
    process.env.VELOCIOUS_REQUEST_TIMEOUT_MS = "1"

    try {
      await Dummy.run(async () => {
        const response = await fetch("http://localhost:3006/slow?waitSeconds=0.2&timeoutSeconds=0.05")
        const body = await response.text()

        expect(response.status).toEqual(500)
        expect(body).toContain("Request timed out after 0.05s")
      })
    } finally {
      if (originalTimeoutEnv === undefined) {
        delete process.env.VELOCIOUS_REQUEST_TIMEOUT_MS
      } else {
        process.env.VELOCIOUS_REQUEST_TIMEOUT_MS = originalTimeoutEnv
      }
    }
  })
})
