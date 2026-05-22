import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - translation fallbacks", {tags: ["dummy"]}, () => {
  it("creates a new simple record with relationships and translations with fallbacks", async () => {
    const task = new Task({name: "Test task"})
    const project = task.buildProject({nameDe: "Test projekt"})

    expect(project.name()).toEqual("Test projekt")
    expect(project.nameEn()).toEqual(undefined)
    expect(project.nameDe()).toEqual("Test projekt")

    await task.save()

    const sameTask = /** @type {Task} */ (await Task.preload({project: {translations: true}}).find(task.id()))
    const sameProject = sameTask.project()

    expect(sameProject.name()).toEqual("Test projekt")
    expect(sameProject.nameEn()).toEqual(undefined)
    expect(sameProject.nameDe()).toEqual("Test projekt")
  })

  it("preloads the current translation for translated records", async () => {
    const task = new Task({name: "Test task"})
    const project = task.buildProject({nameDe: "Test projekt", nameEn: "Test project"})
    const fallbackTask = new Task({name: "Fallback task"})
    const fallbackProject = fallbackTask.buildProject({nameDe: "Fallback projekt"})

    await task.save()
    await fallbackTask.save()

    const sameProject = await Project.preload("currentTranslation").find(project.id())
    const currentTranslation = sameProject.currentTranslation()
    const sameFallbackProject = await Project.preload("currentTranslation").find(fallbackProject.id())
    const fallbackTranslation = sameFallbackProject.currentTranslation()

    expect(currentTranslation.locale()).toEqual("en")
    expect(currentTranslation.name()).toEqual("Test project")
    expect(fallbackTranslation.locale()).toEqual("de")
    expect(fallbackTranslation.name()).toEqual("Fallback projekt")
  })
})
