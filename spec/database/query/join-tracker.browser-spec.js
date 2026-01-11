import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Database - query - join tracker", {tags: ["dummy"]}, () => {
  it("aliases duplicated joins and exposes table names by join path", async () => {
    const query = Task.joins({project: {tasks: true}})
    const driver = query.driver
    const expectedAlias = "tasks__project__tasks"

    expect(query.getTableForJoin("project", "tasks")).toBe(driver.quoteTable(expectedAlias))

    const sql = query.toSql()
    const joinTableSql = `${driver.quoteTable("tasks")} AS ${driver.quoteTable(expectedAlias)}`
    const aliasedForeignKey = `${driver.quoteTable(expectedAlias)}.${driver.quoteColumn("project_id")}`

    expect(sql).toContain(`LEFT JOIN ${joinTableSql}`)
    expect(sql).toContain(aliasedForeignKey)
  })

  it("uses scoped join paths in scope callbacks", async () => {
    if (!Project.getRelationshipsMap().scopedTasksForJoinPath) {
      Project.hasMany("scopedTasksForJoinPath", function() {
        const table = this.getTableForJoin()
        const column = this.driver.quoteColumn("is_done")

        return this.where(`${table}.${column} = 1`)
      }, {className: "Task"})
    }

    const joinObject = {project: {}}
    joinObject.project.scopedTasksForJoinPath = true

    const query = Task.joins(joinObject)
    const driver = query.driver
    const expectedAlias = "tasks__project__scopedTasksForJoinPath"
    const expectedCondition = `${driver.quoteTable(expectedAlias)}.${driver.quoteColumn("is_done")} = 1`

    expect(query.toSql()).toContain(expectedCondition)
  })

  it("applies scope filters to joined relationships", async () => {
    const query = Task.joins({project: {doneTasks: true}})
    const driver = query.driver
    const expectedAlias = "tasks__project__doneTasks"

    expect(query.toSql()).toContain(`${driver.quoteTable(expectedAlias)}.${driver.quoteColumn("is_done")}`)
  })

  it("qualifies where.not hash columns in join scopes", async () => {
    if (!Project.getRelationshipsMap().notDoneTasksForJoinPath) {
      Project.hasMany("notDoneTasksForJoinPath", function() {
        return this.where.not({isDone: null})
      }, {className: "Task"})
    }

    const joinObject = {project: {}}
    joinObject.project.notDoneTasksForJoinPath = true

    const query = Task.joins(joinObject)
    const driver = query.driver
    const expectedAlias = "tasks__project__notDoneTasksForJoinPath"
    const expectedCondition = `NOT ((${driver.quoteTable(expectedAlias)}.${driver.quoteColumn("is_done")} IS NULL))`

    expect(query.toSql()).toContain(expectedCondition)
  })

  it("merges array join branches for the same relationship", async () => {
    const query = Task.joins([
      {project: {translations: true}},
      {project: {projectDetail: true}}
    ])
    const driver = query.driver
    const sql = query.toSql()

    expect(sql).toContain(driver.quoteTable("project_translations"))
    expect(sql).toContain(driver.quoteTable("project_details"))
  })
})
