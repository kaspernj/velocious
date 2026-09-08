import Handler from "../../../src/database/handler.js"
import Project from "../../dummy/src/models/project.js"
import Query from "../../../src/database/query/index.js"
import Record from "../../../src/database/record/index.js"
import Task from "../../dummy/src/models/task.js"
import WhereHash from "../../../src/database/query/where-hash.js"

describe("Database - query - explicit IN SQL", {tags: ["dummy"]}, () => {
  it("groups mixed membership locally and casts MSSQL text operands", async () => {
    class TextMembershipTask extends Record {
      static getColumnTypeByName(name) {
        if (name === "description") return "text"

        return super.getColumnTypeByName(name)
      }
    }

    TextMembershipTask.setTableName("tasks")
    await TextMembershipTask.ensureInitialized()
    const query = TextMembershipTask.where({description: {in: [null, "manual"]}, projectId: 7})
    const options = query.getOptions()
    const column = options.quoteColumnName("description")
    const operand = query.driver.getType() === "mssql" ? `CAST(${column} AS NVARCHAR(MAX))` : column

    expect(query.toSql()).toContain(`((${operand} IN (${options.quote("manual")}) OR ${column} IS NULL) AND ${options.quoteColumnName("project_id")} = 7)`)
  })

  it("uses IS NULL or false without emitting an empty IN branch", () => {
    const options = Task.all().getOptions()

    expect(Task.where({description: {in: [null, null]}}).toSql()).toContain(`WHERE (${options.quoteColumnName("description")} IS NULL)`)
    expect(Task.where({description: {in: []}}).toSql()).toContain("WHERE (1=0)")
    expect(Task.all().whereNot({description: {in: []}}).toSql()).toContain("NOT ((1=0))")
  })

  it("retains legacy raw top-level table/in-column ambiguity", () => {
    const driver = Task.all().driver
    const query = new Query({driver, handler: new Handler()})
    const options = query.getOptions()

    expect(new WhereHash(query, {someTable: {in: [null, "manual"]}}).toSql()).toEqual(
      `(${options.quoteTableName("someTable")}.${options.quoteColumnName("in")} IN (${options.quote(null)}, ${options.quote("manual")}))`
    )
    expect(new WhereHash(query, {someTable: {someColumn: {in: [null, "manual"]}}}).toSql()).toEqual(
      `((${options.quoteTableName("someTable")}.${options.quoteColumnName("someColumn")} IN (${options.quote("manual")}) OR ${options.quoteTableName("someTable")}.${options.quoteColumnName("someColumn")} IS NULL))`
    )
    expect(new WhereHash(query, {someTable: {in: ["manual"]}}).toSql()).toEqual(
      `(${options.quoteTableName("someTable")}.${options.quoteColumnName("in")} IN (${options.quote("manual")}))`
    )
  })

  it("rejects malformed descriptors and members at recognized column boundaries", async () => {
    const invalidConditions = [
      {in: "manual"}, {in: null}, {in: undefined}, {}, {unexpected: []},
      {in: ["manual"], unexpected: true}, {in: [undefined]}, {in: [NaN]},
      {in: [Infinity]}, {in: [-Infinity]}, {in: [[]]}, {in: [{}]}, {in: [new Date()]},
      {in: Array(1)}, Object.defineProperty({in: ["manual"]}, "extra", {value: true}),
      {in: ["manual"], [Symbol("extra")]: true},
      Object.create({in: ["manual"]})
    ]

    for (const condition of invalidConditions) {
      await expect(() => Task.where({description: condition}).toSql()).toThrow(/Invalid IN condition/)
      await expect(() => Task.where({project: {creatingUserReference: condition}}).toSql()).toThrow(/Invalid IN condition/)
      if ("in" in condition) {
        await expect(() => Task.where({tasks: {description: condition}}).toSql()).toThrow(/Invalid IN condition/)
      }
    }
  })

  it("preserves legacy direct-array SQL including NULL", () => {
    const query = Task.where({description: [null, "manual"]})
    const options = query.getOptions()

    expect(query.toSql()).toContain(`WHERE (${options.quoteColumnName("description")} IN (${options.quote(null)}, ${options.quote("manual")}))`)
    expect(Task.where({description: []}).toSql()).toContain("WHERE (1=0)")
  })

  it("keeps mapped attributes named in distinct from operators even in relationships", async () => {
    class InColumnProject extends Record {
      static getAttributeNameToColumnNameMap() {
        return {...super.getAttributeNameToColumnNameMap(), in: "creating_user_reference"}
      }
    }

    InColumnProject.setTableName("projects")
    await InColumnProject.ensureInitialized()
    const query = InColumnProject.where({in: [null, "manual"]})
    const options = query.getOptions()

    expect(query.toSql()).toContain(`WHERE (${options.quoteColumnName("creating_user_reference")} IN (${options.quote(null)}, ${options.quote("manual")}))`)

    class InColumnTask extends Record {}

    InColumnTask.setTableName("tasks")
    InColumnTask.belongsTo("project", {className: "InColumnProject", foreignKey: "project_id"})
    await InColumnTask.ensureInitialized()
    const related = InColumnTask.where({project: {in: ["manual"]}})

    expect(related.toSql()).toContain(`${related.getTableForJoin("project")}.${options.quoteColumnName("creating_user_reference")} IN (${options.quote("manual")})`)
  })

  it("normalizes character varying and UUID metadata without losing null", async () => {
    class TypedMembershipProject extends Record {
      static getColumnTypeByName(name) {
        if (name === "creating_user_reference") return "uuid"
        if (name === "tasks_count") return "character varying"

        return super.getColumnTypeByName(name)
      }
    }

    TypedMembershipProject.setTableName("projects")
    await TypedMembershipProject.ensureInitialized()
    const options = Project.all().getOptions()

    expect(TypedMembershipProject.where({creatingUserReference: {in: [0, null]}}).toSql()).toContain(`WHERE (${options.quoteColumnName("creating_user_reference")} IS NULL)`)
    expect(TypedMembershipProject.where({creatingUserReference: {in: [0]}}).toSql()).toContain("WHERE (1=0)")
    expect(TypedMembershipProject.where({tasksCount: {in: [0]}}).toSql()).toContain(`WHERE (${options.quoteColumnName("tasks_count")} IN (${options.quote("0")}))`)
  })

  it("qualifies relationship predicates with distinct join aliases", () => {
    const query = Task.where({project: {creatingUserReference: {in: [null, "manual"]}}, reviewProject: {creatingUserReference: {in: ["github"]}}})
    const options = query.getOptions()
    const projectColumn = `${query.getTableForJoin("project")}.${options.quoteColumnName("creating_user_reference")}`
    const reviewColumn = `${query.getTableForJoin("reviewProject")}.${options.quoteColumnName("creating_user_reference")}`

    expect(query.toSql()).toContain(`(${projectColumn} IN (${options.quote("manual")}) OR ${projectColumn} IS NULL)`)
    expect(query.toSql()).toContain(`${reviewColumn} IN (${options.quote("github")})`)
    expect(projectColumn).not.toEqual(reviewColumn)
  })

  it("preserves raw nested table recursion and frozen qualified descriptors", () => {
    const query = new Query({driver: Task.all().driver, handler: new Handler()})
    const options = query.getOptions()
    const members = Object.freeze([null, "it's manual", false, 0, ""])
    const conditions = Object.freeze({tasks: Object.freeze({name: Object.freeze({in: members})})})
    const predicate = new WhereHash(query, conditions)
    const column = `${options.quoteTableName("tasks")}.${options.quoteColumnName("name")}`
    const expected = `((${column} IN (${["it's manual", false, 0, ""].map((value) => options.quote(value)).join(", ")}) OR ${column} IS NULL))`

    expect(predicate.toSql()).toEqual(expected)
    expect(predicate.toSql()).toEqual(expected)
    expect(members).toEqual([null, "it's manual", false, 0, ""])
    expect(new WhereHash(query, {outer: {tasks: {name: "manual"}}}).toSql()).toEqual(`(${column} = ${options.quote("manual")})`)
    expect(Task.where({tasks: {in: ["manual"]}}).toSql()).toContain(`WHERE (${options.quoteTableName("tasks")}.${options.quoteColumnName("in")} IN (${options.quote("manual")}))`)
  })

  it("retains the current join-scope alias when negating a grouped predicate", () => {
    const membershipScope = Task.defineScope(({query}) => query.whereNot({description: {in: [null, "manual"]}, projectId: 7}))
    const query = Task
      .joins({project: {tasks: true}})
      .scope(["project", "tasks"], membershipScope.scope())
    const options = query.getOptions()
    const table = query.getTableForJoin("project", "tasks")
    const column = `${table}.${options.quoteColumnName("description")}`
    const castText = query.driver.getType() === "mssql" && Task.getColumnTypeByName("description")?.toLowerCase() === "text"
    const operand = castText ? `CAST(${column} AS NVARCHAR(MAX))` : column

    expect(query.toSql()).toContain(`NOT (((${operand} IN (${options.quote("manual")}) OR ${column} IS NULL) AND ${table}.${options.quoteColumnName("project_id")} = 7))`)
  })
})
