import Comment from "../../dummy/src/models/comment.js"
import Project from "../../dummy/src/models/project.js"
import ProjectDetail from "../../dummy/src/models/project-detail.js"
import Task from "../../dummy/src/models/task.js"
import UuidInteraction from "../../dummy/src/models/uuid-interaction.js"
import UuidItem from "../../dummy/src/models/uuid-item.js"
import User from "../../dummy/src/models/user.js"

describe("Database - query - model class query", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("counts distinct records", async () => {
    const project = await Project.create({nameEn: "Project name", nameDe: "Projektname"})
    await Task.create({name: "Task 1", project})

    const rawCount = await Task.joins({project: {translations: true}}).count()
    const distinctCount = await Task.joins({project: {translations: true}}).distinct().count()

    expect(rawCount).toEqual(2)
    expect(distinctCount).toEqual(1)
  })

  it("replaces accumulated selects with reselect", async () => {
    const project = await Project.create({nameEn: "Reselect project", nameDe: "Auswahl-Projekt"})
    await Task.create({name: "Reselect task", project})

    const query = Task.where({})
    query.select("tasks.id AS picked_id")
    query.select("tasks.name AS picked_name")
    const reselected = query.reselect("tasks.name AS just_name")
    const rows = /** @type {{just_name?: string, picked_id?: number, picked_name?: string}[]} */ (
      /** @type {unknown} */ (await reselected.results())
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].just_name).toEqual("Reselect task")
    expect(rows[0].picked_id).toBeUndefined()
    expect(rows[0].picked_name).toBeUndefined()
  })

  it("drops every select when reselect is called with no argument", async () => {
    const project = await Project.create({nameEn: "Reselect default", nameDe: "Reselect-Standard"})
    await Task.create({name: "Default columns task", project})

    const query = Task.where({})
    query.select("tasks.id AS picked_id")
    const tasks = await query.reselect().toArray()

    expect(tasks).toHaveLength(1)
    expect(tasks[0].name()).toEqual("Default columns task")
  })

  it("counts distinct records across groups without collapsing counts", async () => {
    const project1 = await Project.create({nameEn: "Alpha", nameDe: "Alfa"})
    const project2 = await Project.create({nameEn: "Beta", nameDe: "Beta"})

    await Task.create({name: "Task 1", project: project1})
    await Task.create({name: "Task 2", project: project1})
    await Task.create({name: "Task 3", project: project2})
    await Task.create({name: "Task 4", project: project2})

    const count = await Task.group("tasks.project_id").distinct().count()

    expect(count).toEqual(4)
  })

  it("findOrInitializeBy marks new records as new and changed", async () => {
    const record = await Task.where({name: "New Task"}).findOrInitializeBy({name: "New Task"})

    expect(record.isNewRecord()).toEqual(true)
    expect(record.isChanged()).toEqual(true)
  })

  it("filters on boolean values using camelized attribute names", async () => {
    const project = await Project.create({nameEn: "Boolean Tasks", nameDe: "Boolesche Aufgaben"})

    await Task.create({name: "Task True 1", project, isDone: true})
    await Task.create({name: "Task True 2", project, isDone: true})
    await Task.create({name: "Task False 1", project, isDone: false})
    await Task.create({name: "Task False 2", project, isDone: false})

    const trueNames = (await Task.where({isDone: true}).toArray()).map((task) => task.name()).sort()
    const falseNames = (await Task.where({isDone: false}).toArray()).map((task) => task.name()).sort()

    expect(trueNames).toEqual(["Task True 1", "Task True 2"])
    expect(falseNames).toEqual(["Task False 1", "Task False 2"])
  })

  it("defines root scopes on record classes", async () => {
    Task.withDoneState = Task.defineScope(({query}, isDone) => query.where({isDone}))

    const project = await Project.create({nameEn: "Scoped Tasks", nameDe: "Bereichte Aufgaben"})

    await Task.create({isDone: true, name: "Done scoped task", project})
    await Task.create({isDone: false, name: "Open scoped task", project})

    const names = (await Task.withDoneState(true).toArray()).map((task) => task.name())

    expect(names).toEqual(["Done scoped task"])
  })

  it("applies reusable record scopes to existing queries", async () => {
    Task.withDoneState = Task.defineScope(({query}, isDone) => query.where({isDone}))

    const project = await Project.create({nameEn: "Scoped Query Project", nameDe: "Bereichte Abfrageprojekt"})

    await Task.create({isDone: true, name: "Scoped done task", project})
    await Task.create({isDone: false, name: "Scoped open task", project})

    const names = (await Task
      .joins({project: true})
      .where({projects: {id: project.id()}})
      .scope(Task.withDoneState.scope(true))
      .toArray())
      .map((task) => task.name())

    expect(names).toEqual(["Scoped done task"])
  })

  it("passes the active table alias into raw SQL record scopes", () => {
    Task.nameLike = Task.defineScope(({driver, query, table}, value) => query.where(
      `${driver.quoteTable(table)}.${driver.quoteColumn("name")} LIKE ${driver.quote(`%${value}%`)}`
    ))

    const query = Task
      .all()
      .from("tasks AS scoped_tasks")
      .scope(Task.nameLike.scope("needle"))
    const sql = query.toSql()

    expect(sql).toContain(`${query.driver.quoteTable("scoped_tasks")}.${query.driver.quoteColumn("name")} LIKE ${query.driver.quote("%needle%")}`)
  })

  it("applies record scopes on joined paths using the joined table alias", async () => {
    Task.nameLike = Task.defineScope(({driver, query, table}, value) => query.where(
      `${driver.quoteTable(table)}.${driver.quoteColumn("name")} LIKE ${driver.quote(`%${value}%`)}`
    ))

    const matchingProject = await Project.create({nameEn: "Match root", nameDe: "Treffer wurzel"})
    const missingProject = await Project.create({nameEn: "Miss root", nameDe: "Fehlt wurzel"})

    await Task.create({name: "Root task match", project: matchingProject})
    await Task.create({name: "Needle child task", project: matchingProject})
    await Task.create({name: "Root task miss", project: missingProject})
    await Task.create({name: "Haystack child task", project: missingProject})

    const names = (await Task
      .joins({project: {tasks: true}})
      .scope(["project", "tasks"], Task.nameLike.scope("Needle"))
      .distinct()
      .toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Needle child task", "Root task match"])
  })

  it("keeps joined-path context when a joined scope adds nested joins", async () => {
    Task.withCommentBody = Task.defineScope(({driver, query}, body) => query
      .joins({comments: true})
      .where(`${query.getTableForJoin("comments")}.${driver.quoteColumn("body")} = ${driver.quote(body)}`))

    const matchingUser = await User.create({email: "joined-scope-match@example.com", encryptedPassword: "secret", reference: "joined-scope-match"})
    const missingUser = await User.create({email: "joined-scope-miss@example.com", encryptedPassword: "secret", reference: "joined-scope-miss"})
    const matchingProject = await Project.create({creatingUserReference: matchingUser.reference(), nameEn: "Join scope match", nameDe: "Join bereich treffer"})
    const missingProject = await Project.create({creatingUserReference: missingUser.reference(), nameEn: "Join scope miss", nameDe: "Join bereich fehlt"})
    const childTaskMatch = await Task.create({name: "Child task match", project: matchingProject})
    const childTaskMiss = await Task.create({name: "Child task miss", project: missingProject})

    await Comment.create({body: "needle", task: childTaskMatch})
    await Comment.create({body: "haystack", task: childTaskMiss})

    const emails = (await User
      .joins({createdProjects: {tasks: true}})
      .scope(["createdProjects", "tasks"], Task.withCommentBody.scope("needle"))
      .distinct()
      .toArray())
      .map((user) => user.email())
      .sort()

    expect(emails).toEqual(["joined-scope-match@example.com"])
  })

  it("raises when applying the wrong model scope to a joined path", () => {
    Task.withDoneState = Task.defineScope(({query}, isDone) => query.where({isDone}))
    Project.activeNamed = Project.defineScope(({query}, value) => query.where({nameEn: value}))
    const query = Task.joins({project: true})

    expect(() => query.scope("project", Task.withDoneState.scope(true))).toThrow(/Cannot apply Task scope to join path project/)
    expect(() => query.scope("project", Project.activeNamed.scope("Match"))).not.toThrow()
  })

  it("filters on nested relationship attributes", async () => {
    const projectMatch = await Project.create({
      creatingUserReference: "creator-1",
      nameEn: "Match Project",
      nameDe: "Trefferprojekt"
    })
    const projectMiss = await Project.create({
      creatingUserReference: "creator-2",
      nameEn: "Miss Project",
      nameDe: "Fehlprojekt"
    })

    await Task.create({name: "Match Task", project: projectMatch})
    await Task.create({name: "Miss Task", project: projectMiss})

    const names = (await Task.where({project: {creatingUserReference: "creator-1"}}).toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Match Task"])
  })

  it("applies ransack predicates from the model class", async () => {
    const projectMatch = await Project.create({
      creatingUserReference: "creator-ransack-1",
      nameEn: "Ransack Match Project",
      nameDe: "Ransack Trefferprojekt"
    })
    const projectMiss = await Project.create({
      creatingUserReference: "creator-ransack-2",
      nameEn: "Ransack Miss Project",
      nameDe: "Ransack Fehlprojekt"
    })

    await ProjectDetail.create({project: projectMatch, isActive: true, note: "Needs review"})
    await ProjectDetail.create({project: projectMiss, isActive: false, note: "Ignore me"})

    await Task.create({name: "Alpha needle task", project: projectMatch})
    await Task.create({name: "Beta needle task", project: projectMiss})

    const names = (await Task.ransack({
      name_cont: "needle",
      project_project_detail_is_active_eq: true
    }).toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Alpha needle task"])
  })

  it("applies ransack predicates on existing query instances", async () => {
    const project = await Project.create({
      creatingUserReference: "creator-ransack-3",
      nameEn: "Ransack Query Project",
      nameDe: "Ransack Abfrageprojekt"
    })

    await Task.create({name: "Alpha task", project})
    await Task.create({name: "Beta task", project, isDone: false})
    await Task.create({name: "Beta archived", project, isDone: true})

    const names = (await Task
      .where({projectId: project.id()})
      .ransack({name_start: "Beta", is_done_not_eq: true})
      .toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Beta task"])
  })

  it("prefers root attributes over relationship prefixes in ransack keys", async () => {
    const projectMatch = await Project.create({
      creatingUserReference: "owner-ransack-match",
      nameEn: "Owner Match Project",
      nameDe: "Eigentuemer Trefferprojekt"
    })
    const projectMiss = await Project.create({
      creatingUserReference: "owner-ransack-miss",
      nameEn: "Owner Miss Project",
      nameDe: "Eigentuemer Fehlprojekt"
    })

    await Task.create({name: "Owner match task", project: projectMatch})
    await Task.create({name: "Owner miss task", project: projectMiss})

    const names = (await Project.ransack({creating_user_reference_eq: "owner-ransack-match"}).toArray())
      .map((project) => project.creatingUserReference())

    expect(names).toEqual(["owner-ransack-match"])
  })

  it("keeps polymorphic foreign-key ransack filters on the root model", async () => {
    const uuidItem = await UuidItem.create({title: "Uuid item"})
    const otherUuidItem = await UuidItem.create({title: "Other uuid item"})

    await UuidInteraction.create({kind: "match", subject: uuidItem})
    await UuidInteraction.create({kind: "miss", subject: otherUuidItem})

    const kinds = (await UuidInteraction.ransack({subject_id_eq: uuidItem.id()}).toArray())
      .map((interaction) => interaction.kind())

    expect(kinds).toEqual(["match"])
  })

  it("applies sort from ransack s param", async () => {
    const project = await Project.create({
      creatingUserReference: "creator-sort-1",
      nameEn: "Sort Project",
      nameDe: "Sortierprojekt"
    })

    await Task.create({name: "Charlie sort task", project})
    await Task.create({name: "Alpha sort task", project})
    await Task.create({name: "Beta sort task", project})

    const names = (await Task.ransack({nameCont: "sort task", s: "name asc"}).toArray())
      .map((task) => task.name())

    expect(names).toEqual(["Alpha sort task", "Beta sort task", "Charlie sort task"])
  })

  it("applies descending sort from ransack s param", async () => {
    const project = await Project.create({
      creatingUserReference: "creator-sort-2",
      nameEn: "Desc Sort Project",
      nameDe: "Absteigend Sortierprojekt"
    })

    await Task.create({name: "Charlie desc task", project})
    await Task.create({name: "Alpha desc task", project})
    await Task.create({name: "Beta desc task", project})

    const names = (await Task.ransack({nameCont: "desc task", s: "name desc"}).toArray())
      .map((task) => task.name())

    expect(names).toEqual(["Charlie desc task", "Beta desc task", "Alpha desc task"])
  })

  it("filters on deep nested relationship attributes", async () => {
    const projectMatch = await Project.create({
      creatingUserReference: "creator-3",
      nameEn: "Deep Match Project",
      nameDe: "Tiefes Trefferprojekt"
    })
    const projectMiss = await Project.create({
      creatingUserReference: "creator-4",
      nameEn: "Deep Miss Project",
      nameDe: "Tiefes Fehlprojekt"
    })

    await ProjectDetail.create({project: projectMatch, note: "Needs attention"})
    await ProjectDetail.create({project: projectMiss, note: "Other note"})

    await Task.create({name: "Deep Match Task", project: projectMatch})
    await Task.create({name: "Deep Miss Task", project: projectMiss})

    const names = (await Task.where({project: {projectDetail: {note: "Needs attention"}}}).toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Deep Match Task"])
  })

  it("filters on deep nested boolean attributes", async () => {
    const projectMatch = await Project.create({
      creatingUserReference: "creator-5",
      nameEn: "Deep Bool Match Project",
      nameDe: "Tiefes Boolesches Trefferprojekt"
    })
    const projectMiss = await Project.create({
      creatingUserReference: "creator-6",
      nameEn: "Deep Bool Miss Project",
      nameDe: "Tiefes Boolesches Fehlprojekt"
    })

    await ProjectDetail.create({project: projectMatch, isActive: true, note: "Active"})
    await ProjectDetail.create({project: projectMiss, isActive: false, note: "Inactive"})

    await Task.create({name: "Deep Bool Match Task", project: projectMatch})
    await Task.create({name: "Deep Bool Miss Task", project: projectMiss})

    const names = (await Task.where({project: {projectDetail: {isActive: true}}}).toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Deep Bool Match Task"])
  })

  it("filters on nested relationship attributes with where operator tuples", async () => {
    const projectMatch = await Project.create({
      nameEn: "Needle Project",
      nameDe: "Anderes Projekt"
    })
    const projectMiss = await Project.create({
      nameEn: "Haystack Project",
      nameDe: "Nicht passend"
    })

    await Task.create({name: "Tuple Match Task", project: projectMatch})
    await Task.create({name: "Tuple Miss Task", project: projectMiss})

    const names = (await Task.where({project: {translations: [["name", "like", "%Needle%"]]}}).toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Tuple Match Task"])
  })

  it("filters on deep nested relationship attributes with multiple where tuples", async () => {
    const cutoff = new Date("2025-01-01T00:00:00.000Z")
    const matchingUser = await User.create({
      createdAt: new Date("2025-02-01T00:00:00.000Z"),
      email: "creator-match@example.com",
      encryptedPassword: "secret",
      reference: "creator-match"
    })
    const oldUser = await User.create({
      createdAt: new Date("2024-02-01T00:00:00.000Z"),
      email: "creator-old@example.com",
      encryptedPassword: "secret",
      reference: "creator-old"
    })
    const otherUser = await User.create({
      createdAt: new Date("2025-02-01T00:00:00.000Z"),
      email: "other-user@example.com",
      encryptedPassword: "secret",
      reference: "other-user"
    })
    const projectMatch = await Project.create({
      creatingUserReference: matchingUser.reference(),
      nameEn: "Nested Tuple Match",
      nameDe: "Verschachteltes Tupel Treffer"
    })
    const projectOld = await Project.create({
      creatingUserReference: oldUser.reference(),
      nameEn: "Nested Tuple Miss Old",
      nameDe: "Verschachteltes Tupel Alt"
    })
    const projectOther = await Project.create({
      creatingUserReference: otherUser.reference(),
      nameEn: "Nested Tuple Miss Other",
      nameDe: "Verschachteltes Tupel Andere"
    })

    await Task.create({name: "Nested Tuple Match Task", project: projectMatch})
    await Task.create({name: "Nested Tuple Old Task", project: projectOld})
    await Task.create({name: "Nested Tuple Other Task", project: projectOther})

    const names = (await Task.where({
      project: {
        creatingUser: [["reference", "like", "creator-%", ["createdAt", "gteq", cutoff]]]
      }
    }).toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Nested Tuple Match Task"])
  })

  it("supports symbolic relationship where tuple operators", async () => {
    const cutoff = new Date("2025-01-01T00:00:00.000Z")
    const matchingUser = await User.create({
      createdAt: new Date("2025-02-01T00:00:00.000Z"),
      email: "symbolic-creator-match@example.com",
      encryptedPassword: "secret",
      reference: "symbolic-creator-match"
    })
    const oldUser = await User.create({
      createdAt: new Date("2024-02-01T00:00:00.000Z"),
      email: "symbolic-creator-old@example.com",
      encryptedPassword: "secret",
      reference: "symbolic-creator-old"
    })
    const projectMatch = await Project.create({
      creatingUserReference: matchingUser.reference(),
      nameEn: "Symbolic Tuple Match",
      nameDe: "Symbolisches Tupel Treffer"
    })
    const projectOld = await Project.create({
      creatingUserReference: oldUser.reference(),
      nameEn: "Symbolic Tuple Miss Old",
      nameDe: "Symbolisches Tupel Alt"
    })

    await Task.create({name: "Symbolic Tuple Match Task", project: projectMatch})
    await Task.create({name: "Symbolic Tuple Old Task", project: projectOld})

    const names = (await Task.where({
      project: {
        creatingUser: [["reference", "like", "symbolic-creator-%", ["createdAt", ">=", cutoff]]]
      }
    }).toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Symbolic Tuple Match Task"])
  })

  it("forwards unknown keys to the base where hash", async () => {
    const project = await Project.create({nameEn: "Fallback Project", nameDe: "Fallback Projekt"})
    await Task.create({name: "Fallback Task", project})

    const names = (await Task.where({project_id: project.id()}).toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Fallback Task"])
  })

  it("returns no results when where is given an empty array", async () => {
    const project = await Project.create({nameEn: "Empty Where", nameDe: "Leere Abfrage"})
    await Task.create({name: "Task 1", project})

    const results = await Task.where({id: []}).toArray()

    expect(results).toEqual([])
  })

  it("filters with where.not using attribute names", async () => {
    const project = await Project.create({nameEn: "Not Attribute", nameDe: "Nicht Attribut"})

    await Task.create({name: "Done Task", project, isDone: true})
    await Task.create({name: "Open Task", project, isDone: false})

    const names = (await Task.all().where.not({isDone: true}).toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Open Task"])
  })

  it("filters with where.not using column names", async () => {
    const projectMatch = await Project.create({nameEn: "Column Match", nameDe: "Spalten Treffer"})
    const projectMiss = await Project.create({nameEn: "Column Miss", nameDe: "Spalten Fehl"})

    await Task.create({name: "Match Task", project: projectMatch})
    await Task.create({name: "Miss Task", project: projectMiss})

    const names = (await Task.all().where.not({project_id: projectMatch.id()}).toArray())
      .map((task) => task.name())
      .sort()

    expect(names).toEqual(["Miss Task"])
  })
})
