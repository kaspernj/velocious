// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import { BrowserTestSession } from "../../scripts/browser-test-session.js"

describe("browser test session", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("terminates startup resources and reports retained driver diagnostics", async () => {
    const calls = []
    const previousRemoteUrl = process.env.SELENIUM_REMOTE_URL
    const chromeDriverService = {
      diagnostics: async () => "ChromeDriver log:\nsession creation stalled",
      start: async () => {
        calls.push("driver:start")
        return "http://127.0.0.1:4567"
      },
      stop: async () => {
        calls.push("driver:stop")
      }
    }
    const systemTest = {
      start: async () => {
        calls.push("system-test:start")
        throw new Error("timeout while starting Selenium WebDriver")
      },
      stop: async () => {
        calls.push("system-test:stop")
      }
    }
    const session = new BrowserTestSession({
      chromeDriverServiceFactory: async () => chromeDriverService,
      processSnapshot: async (phase) => `${phase}: chromedriver pid=123`,
      runtime: {
        browserPath: "/opt/chrome/chrome",
        browserVersion: "145.0.7632.117",
        driverPath: "/opt/chromedriver/chromedriver",
        driverVersion: "145.0.7632.117"
      },
      systemTestFactory: () => systemTest
    })
    let startupError

    try {
      await session.start()
    } catch (error) {
      startupError = error
    }

    expect(calls).toEqual([
      "driver:start",
      "system-test:start",
      "driver:stop",
      "system-test:stop"
    ])
    expect(startupError?.message).toContain("timeout while starting Selenium WebDriver")
    expect(startupError?.message).toContain("creating Selenium WebDriver session")
    expect(startupError?.message).toContain("ChromeDriver service: http://127.0.0.1:4567")
    expect(startupError?.message).toContain("ChromeDriver log:\nsession creation stalled")
    expect(startupError?.message).toContain("before cleanup: chromedriver pid=123")
    expect(startupError?.message).toContain("after cleanup: chromedriver pid=123")
    expect(process.env.SELENIUM_REMOTE_URL).toBe(previousRemoteUrl)
  })
})
