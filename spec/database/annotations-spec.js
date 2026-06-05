// @ts-check

import "../../src/database/annotations-async-hooks.js"
import { describe, expect, it } from "../../src/testing/test.js"
import { getDatabaseAnnotations, withDatabaseAnnotation } from "../../src/database/annotations.js"

describe("database annotations", {databaseCleaning: {transaction: true}}, () => {
  it("tracks nested annotations for the current async context", async () => {
    expect(getDatabaseAnnotations()).toEqual([])

    await withDatabaseAnnotation("outer annotation", async () => {
      expect(getDatabaseAnnotations()).toEqual(["outer annotation"])

      await withDatabaseAnnotation("inner annotation", async () => {
        expect(getDatabaseAnnotations()).toEqual(["outer annotation", "inner annotation"])
      })

      expect(getDatabaseAnnotations()).toEqual(["outer annotation"])
    })

    expect(getDatabaseAnnotations()).toEqual([])
  })

  it("restores annotations after callback errors", async () => {
    try {
      await withDatabaseAnnotation("failed annotation", async () => {
        throw new Error("annotation callback failed")
      })
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(/** @type {Error} */ (error).message).toEqual("annotation callback failed")
    }

    expect(getDatabaseAnnotations()).toEqual([])
  })
})
