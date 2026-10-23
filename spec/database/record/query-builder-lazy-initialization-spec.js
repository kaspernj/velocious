// @ts-check

import Record from "../../../src/database/record/index.js"

describe("Record - query builder lazy initialization", {tags: ["dummy"]}, () => {
  it("initializes an uninitialized model on where(...).toArray()", async () => {
    class LazyQueryProject extends Record {}

    LazyQueryProject.setTableName("projects")

    expect(LazyQueryProject.isInitialized()).toEqual(false)

    const projects = await LazyQueryProject.where({id: 0}).toArray()

    expect(Array.isArray(projects)).toEqual(true)
    expect(LazyQueryProject.isInitialized()).toEqual(true)
  })

  it("initializes an uninitialized model on where(...).first()", async () => {
    class LazyFirstProject extends Record {}

    LazyFirstProject.setTableName("projects")

    expect(LazyFirstProject.isInitialized()).toEqual(false)

    await LazyFirstProject.where({}).first()

    expect(LazyFirstProject.isInitialized()).toEqual(true)
  })

  it("initializes an uninitialized model on where(...).count()", async () => {
    class LazyCountProject extends Record {}

    LazyCountProject.setTableName("projects")

    expect(LazyCountProject.isInitialized()).toEqual(false)

    const count = await LazyCountProject.where({}).count()

    expect(typeof count).toEqual("number")
    expect(LazyCountProject.isInitialized()).toEqual(true)
  })
})
