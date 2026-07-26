#!/usr/bin/env node

import fs from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { binaryPaths } = require("selenium-webdriver/common/seleniumManager.js")
const { browserPath, driverPath } = binaryPaths([
  "--browser",
  "chrome",
  "--language-binding",
  "javascript",
  "--output",
  "json",
  "--avoid-browser-download"
])

if (!browserPath || !fs.existsSync(browserPath)) {
  throw new Error(`Selenium Manager did not find installed Chrome at ${browserPath || "<missing path>"}`)
}

if (!driverPath || !fs.existsSync(driverPath)) {
  throw new Error(`Selenium Manager did not provision ChromeDriver at ${driverPath || "<missing path>"}`)
}

console.log(`Prewarmed ChromeDriver at ${driverPath} for Chrome at ${browserPath}`)
