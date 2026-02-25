// @ts-check

import {describe, expect, it} from "../../../../src/testing/test.js"
import backendProjects from "../../../dummy/src/config/backend-projects.js"
import Cli from "../../../../src/cli/index.js"
import Configuration from "../../../../src/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import FrontendModelBase from "../../../../src/frontend-models/base.js"
import path from "node:path"

/**
 * @param {object} args - Build args.
 * @param {import("../../../../src/configuration-types.js").BackendProjectConfiguration[]} [args.backendProjectsList] - Backend projects.
 * @returns {Configuration} - Configuration instance.
 */
function buildConfiguration({backendProjectsList} = {}) {
  return new Configuration({
    backendProjects: backendProjectsList,
    database: {test: {}},
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("Cli - generate - frontend-models", () => {
  it("generates frontend models from configured backend project resources", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({backendProjectsList: backendProjects}),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const taskPath = `${dummyDirectory()}/src/frontend-models/task.js`
    const projectPath = `${dummyDirectory()}/src/frontend-models/project.js`
    const userPath = `${dummyDirectory()}/src/frontend-models/user.js`
    const taskContents = await fs.readFile(taskPath, "utf8")
    const projectContents = await fs.readFile(projectPath, "utf8")
    const userContents = await fs.readFile(userPath, "utf8")

    expect(taskContents).toContain("class Task extends FrontendModelBase")
    expect(taskContents).toContain("path: \"/api/frontend-models/tasks\"")
    expect(taskContents).toContain("\"index\":\"list\"")
    expect(taskContents).toContain("@typedef {object} TaskAttributes")
    expect(taskContents).toContain("@returns {TaskAttributes[\"identifier\"]} - Attribute value.")
    expect(taskContents).toContain("identifier() { return this.readAttribute(\"identifier\") }")
    expect(taskContents).toContain("setIdentifier(newValue) { return this.setAttribute(\"identifier\", newValue) }")
    expect(taskContents).toContain("import Project from \"./project.js\"")
    expect(taskContents).toContain("static relationshipDefinitions()")
    expect(taskContents).toContain("project: {type: \"belongsTo\"}")
    expect(taskContents).toContain("project() { return /** @type {import(\"./project.js\").default | null} */ (this.getRelationshipByName(\"project\").loaded()) }")

    expect(projectContents).toContain("import Task from \"./task.js\"")
    expect(projectContents).toContain("tasks: {type: \"hasMany\"}")
    expect(projectContents).toContain("tasks() { return /** @type {import(\"../../../../src/frontend-models/base.js\").FrontendModelHasManyRelationship<typeof import(\"./project.js\").default, typeof import(\"./task.js\").default>} */ (this.getRelationshipByName(\"tasks\")) }")
    expect(projectContents).toContain("tasksLoaded() { return /** @type {Array<import(\"./task.js\").default>} */ (this.getRelationshipByName(\"tasks\").loaded()) }")

    expect(userContents).toContain("class User extends FrontendModelBase")
    expect(userContents).toContain("\"index\":\"index\"")
    expect(userContents).toContain("email() { return this.readAttribute(\"email\") }")
    expect(userContents).toContain("setEmail(newValue) { return this.setAttribute(\"email\", newValue) }")
  })

  it("fails when no backend projects are configured", async () => {
    const cli = new Cli({
      configuration: buildConfiguration(),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await expect(async () => {
      await cli.execute()
    }).toThrow(/No backend projects configured/)
  })

  it("fails when a resource is missing abilities config", async () => {
    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          resources: {
            Task: {
              attributes: ["id", "name"],
              path: "/tasks"
            }
          }
        }]
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await expect(async () => {
      await cli.execute()
    }).toThrow(/missing required 'abilities' config/)
  })

  it("fails when a relationship target has no frontend model resource", async () => {
    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          resources: {
            Task: {
              abilities: {
                find: "read",
                index: "read"
              },
              attributes: ["id", "name"],
              path: "/tasks",
              relationships: {
                project: {
                  model: "Project",
                  type: "belongsTo"
                }
              }
            }
          }
        }]
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await expect(async () => {
      await cli.execute()
    }).toThrow(/no frontend model resource exists for that target/)
  })

  it("writes generated frontend models to backendProject.frontendModelsOutputPath", async () => {
    const outputDirectory = path.resolve(dummyDirectory(), "../tmp/frontend-model-output")
    await fs.rm(outputDirectory, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          ...backendProjects[0],
          frontendModelsOutputPath: outputDirectory
        }]
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const generatedTaskPath = `${outputDirectory}/src/frontend-models/task.js`
    const generatedTaskContents = await fs.readFile(generatedTaskPath, "utf8")

    expect(generatedTaskContents).toContain("class Task extends FrontendModelBase")

    await fs.rm(outputDirectory, {force: true, recursive: true})
  })

  it("exposes inherited count() on generated frontend model classes", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({backendProjectsList: backendProjects}),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const generatedUserModule = await import(`${dummyDirectory()}/src/frontend-models/user.js`)
    const GeneratedUser = generatedUserModule.default

    expect(typeof GeneratedUser.count).toBe("function")
    expect(Object.hasOwn(GeneratedUser, "count")).toBe(false)
    expect(GeneratedUser.count).toBe(FrontendModelBase.count)
  })
})
