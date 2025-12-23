import TableData from "../../../src/database/table-data/index.js"

describe("TableData references", () => {
  it("does not set both a column index and a table index when index is true", () => {
    const tableData = new TableData("syncs")

    tableData.references("resource", {index: true, polymorphic: true})

    const columns = tableData.getColumns()
    const indexes = tableData.getIndexes()

    // reference column should not carry its own index flag
    expect(columns[0].getIndex()).toBeFalse()

    // only one index should be registered (from the references helper)
    expect(indexes.length).toEqual(1)
  })
})
