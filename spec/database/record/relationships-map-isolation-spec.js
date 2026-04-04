// @ts-check

import DatabaseRecord from "../../../src/database/record/index.js"

describe("Record - getRelationshipsMap isolation", () => {
  it("does not share relationships between sibling model classes", () => {
    class BaseA extends DatabaseRecord {}
    class BaseB extends DatabaseRecord {}

    class ModelA extends BaseA {}
    class ModelB extends BaseB {}

    // Each model defines its own belongsTo — these must NOT leak across classes
    ModelA.belongsTo("project")
    ModelB.belongsTo("task")
    ModelB.belongsTo("user")

    const mapA = ModelA.getRelationshipsMap()
    const mapB = ModelB.getRelationshipsMap()

    expect(Object.keys(mapA)).toEqual(["project"])
    expect(Object.keys(mapB)).toEqual(["task", "user"])

    // Parent classes must not have any relationships
    expect(Object.keys(BaseA.getRelationshipsMap())).toEqual([])
    expect(Object.keys(BaseB.getRelationshipsMap())).toEqual([])
    expect(Object.keys(DatabaseRecord.getRelationshipsMap())).toEqual([])
  })

  it("does not share relationships between models extending the same base", () => {
    class SharedBase extends DatabaseRecord {}

    class ModelX extends SharedBase {}
    class ModelY extends SharedBase {}

    ModelX.belongsTo("account")
    ModelY.belongsTo("invoice")

    expect(Object.keys(ModelX.getRelationshipsMap())).toEqual(["account"])
    expect(Object.keys(ModelY.getRelationshipsMap())).toEqual(["invoice"])
    expect(Object.keys(SharedBase.getRelationshipsMap())).toEqual([])
  })
})
