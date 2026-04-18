import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - autoload - preserves local state", {tags: ["dummy"]}, () => {
  it("does not overwrite a sibling's in-memory belongs-to state set via setProject", async () => {
    const projectA = await Project.create({})
    const projectB = await Project.create({})
    const projectC = await Project.create({})

    await Task.create({name: "Preserve local A", project: projectA})
    await Task.create({name: "Preserve local B", project: projectB})

    const tasks = await Task.where({name: ["Preserve local A", "Preserve local B"]}).toArray()
    const [firstTask, secondTask] = tasks

    // Sibling assigns an in-memory override BEFORE the cohort batch runs.
    secondTask.setProject(projectC)

    await firstTask.projectOrLoad()

    const secondRelationship = secondTask.getRelationshipByName("project")

    // The sibling's locally set project must survive the cohort batch.
    expect(secondRelationship.getLoadedOrUndefined().id()).toEqual(projectC.id())
    expect(secondRelationship.getDirty()).toEqual(true)
  })

  it("does not overwrite a sibling's locally built has-many entry", async () => {
    const projectA = await Project.create({})
    const projectB = await Project.create({})

    await Task.create({name: "HM preserve A1", project: projectA})
    await Task.create({name: "HM preserve B1", project: projectB})

    const projects = await Project.where({id: [projectA.id(), projectB.id()]}).toArray()

    // Sibling builds an unsaved task BEFORE the cohort batch runs.
    const builtTask = projects[1].tasks().build({name: "Locally built task"})

    await projects[0].tasksOrLoad()

    const siblingTasks = projects[1].tasks().getLoadedOrUndefined()

    // The locally built task must still be in the sibling's loaded collection.
    expect(siblingTasks).toContain(builtTask)
  })
})
