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

  it("preserves loose top-level primitives and strict recursive equality", () => {
    facadeExpect("1").toEqual(1)
    facadeExpect({id: "1"}).not.toEqual({id: 1})
  })

  it("preserves loose attribute primitives and strict structured attributes", () => {
    const record = {
      count: () => 1,
      details: () => ({count: 1})
    }

    new LocalExpect(record).toHaveAttributes({count: "1", details: {count: 1}})
    new LocalExpect(record).not.toHaveAttributes({count: "1", details: {count: "1"}})
  })

  it("awaits chained asynchronous change probes sequentially", async () => {
    const observations = []
    let firstValue = 0
    let secondValue = 0
    let firstReads = 0
    let secondReads = 0

    const firstProbe = async () => {
      const phase = firstReads++ === 0 ? "before" : "after"

      observations.push(`first-${phase}-start`)
      await Promise.resolve()
      observations.push(`first-${phase}-end`)

      return firstValue
    }
    const secondProbe = async () => {
      const phase = secondReads++ === 0 ? "before" : "after"

      observations.push(`second-${phase}-start`)
      await Promise.resolve()
      observations.push(`second-${phase}-end`)

      return secondValue
    }
    const expectation = facadeExpect(async () => {
      observations.push("action")
      firstValue += 1
      secondValue += 2
    })

    await expectation
      .toChange(firstProbe)
      .by(1)
      .andChange(secondProbe)
      .by(2)
      .execute()

    facadeExpect(observations).toEqual([
      "first-before-start",
      "first-before-end",
      "second-before-start",
      "second-before-end",
      "action",
      "first-after-start",
      "first-after-end",
      "second-after-start",
      "second-after-end"
    ])
  })

  it("does not coerce functions or structured values for loose compatibility", () => {
    const firstFunction = () => 1
    const secondFunction = () => 1
    let coercions = 0
    const structuredValue = {
      [Symbol.toPrimitive]: () => {
        coercions += 1
        return "1"
      }
    }

    facadeExpect(firstFunction).not.toEqual(secondFunction)
    new LocalExpect(structuredValue).not.toEqual(1)
    facadeExpect(coercions).toBe(0)
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
