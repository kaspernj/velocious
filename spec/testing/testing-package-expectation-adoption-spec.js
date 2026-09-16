// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"

import {
  Expect as PackageExpect,
  arrayContaining as packageArrayContaining,
  expect as packageExpect,
  isArrayContaining as packageIsArrayContaining,
  isObjectContaining as packageIsObjectContaining,
  matchArrayContaining as packageMatchArrayContaining,
  matchObject as packageMatchObject,
  objectContaining as packageObjectContaining
} from "@velocious/testing"

import LocalExpect from "../../src/testing/expect.js"
import {
  arrayContaining as localArrayContaining,
  isArrayContaining as localIsArrayContaining,
  isObjectContaining as localIsObjectContaining,
  matchArrayContaining as localMatchArrayContaining,
  matchObject as localMatchObject,
  objectContaining as localObjectContaining
} from "../../src/testing/expect-utils.js"
import {
  arrayContaining,
  expect as facadeExpect,
  objectContaining
} from "../../src/testing/test.js"

const testingSourceDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "testing")

describe("@velocious/testing expectation adoption", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("delegates the public expectation facade to the package", () => {
    facadeExpect(facadeExpect).toBe(packageExpect)
    facadeExpect(arrayContaining).toBe(packageArrayContaining)
    facadeExpect(objectContaining).toBe(packageObjectContaining)
    facadeExpect(LocalExpect).toBe(PackageExpect)
    facadeExpect(globalThis.expect).toBe(packageExpect)
  })

  it("keeps deep compatibility paths as package re-exports", () => {
    facadeExpect(localArrayContaining).toBe(packageArrayContaining)
    facadeExpect(localIsArrayContaining).toBe(packageIsArrayContaining)
    facadeExpect(localIsObjectContaining).toBe(packageIsObjectContaining)
    facadeExpect(localMatchArrayContaining).toBe(packageMatchArrayContaining)
    facadeExpect(localMatchObject).toBe(packageMatchObject)
    facadeExpect(localObjectContaining).toBe(packageObjectContaining)
  })

  it("contains no local generic expectation implementation", async () => {
    const sourceFiles = await fs.readdir(testingSourceDirectory)
    const facadeSource = await fs.readFile(path.join(testingSourceDirectory, "expect.js"), "utf8")
    const utilityFacadeSource = await fs.readFile(path.join(testingSourceDirectory, "expect-utils.js"), "utf8")

    facadeExpect(sourceFiles).not.toContain("base-expect.js")
    facadeExpect(sourceFiles).not.toContain("expect-to-change.js")
    facadeExpect(facadeSource).not.toMatch(/class Expect|anythingDifferent|ExpectToChange/u)
    facadeExpect(utilityFacadeSource).not.toMatch(/collectMatchDifferences|anythingDifferent|__velociousMatcher/u)
  })
})
