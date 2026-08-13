#!/usr/bin/env node

import { prewarmBrowserTestChromeRuntime } from "./browser-test-session.js"

const runtime = await prewarmBrowserTestChromeRuntime()

console.log(`Prewarmed ChromeDriver ${runtime.driverVersion} at ${runtime.driverPath} for Chrome ${runtime.browserVersion} at ${runtime.browserPath}`)
