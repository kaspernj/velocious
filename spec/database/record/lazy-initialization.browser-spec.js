// @ts-check

import Record from "../../../src/database/record/index.js"

describe("Record - lazy initialization", {tags: ["dummy"]}, () => {
  it("initializes an uninitialized model on first async class API use", async () => {
    class LazyProject extends Record {}

    LazyProject.setTableName("projects")

    expect(LazyProject.isInitialized()).toEqual(false)

    const count = await LazyProject.count()

    expect(typeof count).toEqual("number")
    expect(LazyProject.isInitialized()).toEqual(true)
  })

  it("allows a later lazy initialization retry after an earlier failure", async () => {
    class LazyRetryProject extends Record {}

    LazyRetryProject.setTableName("missing_lazy_retry_projects")

    try {
      await LazyRetryProject.count()
      throw new Error("Didn't expect missing table lookup to succeed")
    } catch (error) {
      expect(error.message).toMatch(/missing_lazy_retry_projects/)
    }

    LazyRetryProject.setTableName("projects")

    const count = await LazyRetryProject.count()

    expect(typeof count).toEqual("number")
    expect(LazyRetryProject.isInitialized()).toEqual(true)
  })
})
