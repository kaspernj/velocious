#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import {execFileSync} from "node:child_process"

import SystemTest from "system-testing/build/system-test.js"

process.env.SYSTEM_TEST_HOST = "dist"
SystemTest.rootPath = "/?systemTest=true"

function parsePositiveIntegerEnv(variableName, defaultValue) {
  const rawValue = process.env[variableName]
  const parsedValue = rawValue === undefined ? defaultValue : Number(rawValue)

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${variableName} must be a positive integer. Got: ${String(rawValue)}`)
  }

  return parsedValue
}

function firstExecutablePath(command) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean)
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]

  for (const pathEntry of pathEntries) {
    for (const extension of extensions) {
      const filePath = path.join(pathEntry, `${command}${extension}`)

      try {
        fs.accessSync(filePath, fs.constants.X_OK)
        return filePath
      } catch (_error) {
        // Keep searching PATH entries.
      }
    }
  }

  return null
}

function versionMajor(versionText) {
  const match = versionText.match(/(\d+)\./)

  return match ? Number(match[1]) : null
}

function executableVersion(filePath) {
  try {
    return execFileSync(filePath, ["--version"], {encoding: "utf8"})
  } catch (_error) {
    return ""
  }
}

function removeMismatchedChromeDriverFromPath() {
  const chromeDriverPath = firstExecutablePath("chromedriver")
  const chromePath = firstExecutablePath("google-chrome") || firstExecutablePath("chrome")

  if (!chromeDriverPath || !chromePath) return

  const chromeDriverMajor = versionMajor(executableVersion(chromeDriverPath))
  const chromeMajor = versionMajor(executableVersion(chromePath))

  if (!chromeDriverMajor || !chromeMajor || chromeDriverMajor === chromeMajor) return

  const chromeDriverDirectory = path.resolve(path.dirname(chromeDriverPath))

  process.env.PATH = (process.env.PATH || "")
    .split(path.delimiter)
    .filter((pathEntry) => path.resolve(pathEntry) !== chromeDriverDirectory)
    .join(path.delimiter)
}

async function elementText(systemTest, testID) {
  const element = await systemTest.findByTestID(testID, {timeout: 30000, useBaseSelector: false})

  return (await element.getText()).trim()
}

async function main() {
  removeMismatchedChromeDriverFromPath()

  const systemTest = SystemTest.current({
    debug: process.env.SYSTEM_TEST_DEBUG === "true",
    httpHost: process.env.SYSTEM_TEST_HTTP_HOST || "127.0.0.1",
    httpPort: parsePositiveIntegerEnv("SYSTEM_TEST_HTTP_PORT", 1984)
  })

  try {
    await systemTest.start()
    systemTest.setBaseSelector("[data-testid='systemTestingComponent']")

    const status = await elementText(systemTest, "expoCompatibilityTestStatus")
    const details = await elementText(systemTest, "expoCompatibilityTestDetails")

    if (status !== "passed") {
      throw new Error(`Expo compatibility tests failed with status '${status}': ${details}`)
    }

    console.log(`Expo compatibility tests passed: ${details}`)
  } finally {
    await systemTest.stop()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
