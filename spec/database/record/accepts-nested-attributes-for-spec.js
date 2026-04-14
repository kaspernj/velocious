// @ts-check

import DatabaseRecord from "../../../src/database/record/index.js"

describe("Record - acceptsNestedAttributesFor", () => {
  it("stores per-relationship policy and returns it via acceptedNestedAttributesFor", () => {
    class Project extends DatabaseRecord {}

    Project.hasMany("tasks")
    Project.acceptsNestedAttributesFor("tasks", {allowDestroy: true, limit: 50})

    const policy = Project.acceptedNestedAttributesFor("tasks")
    expect(policy).toEqual({allowDestroy: true, limit: 50})
  })

  it("returns null when a relationship has not been opted in", () => {
    class Project extends DatabaseRecord {}

    Project.hasMany("tasks")

    expect(Project.acceptedNestedAttributesFor("tasks")).toEqual(null)
  })

  it("does not leak acceptance declarations between sibling model classes", () => {
    class Project extends DatabaseRecord {}
    class Invoice extends DatabaseRecord {}

    Project.acceptsNestedAttributesFor("tasks", {allowDestroy: true})
    Invoice.acceptsNestedAttributesFor("lineItems", {})

    expect(Project.acceptedNestedAttributesFor("tasks")).toEqual({allowDestroy: true})
    expect(Project.acceptedNestedAttributesFor("lineItems")).toEqual(null)
    expect(Invoice.acceptedNestedAttributesFor("lineItems")).toEqual({})
    expect(Invoice.acceptedNestedAttributesFor("tasks")).toEqual(null)
  })

  it("defaults allowDestroy to falsy when not provided", () => {
    class Project extends DatabaseRecord {}

    Project.acceptsNestedAttributesFor("tasks")

    const policy = Project.acceptedNestedAttributesFor("tasks")
    expect(policy?.allowDestroy).toEqual(undefined)
  })

  it("rejects invalid relationshipName inputs", () => {
    class Project extends DatabaseRecord {}

    expect(() => {
      // @ts-expect-error testing invalid input
      Project.acceptsNestedAttributesFor(null, {})
    }).toThrow(/Invalid relationshipName/)

    expect(() => {
      Project.acceptsNestedAttributesFor("", {})
    }).toThrow(/Invalid relationshipName/)
  })
})
