// @ts-check

import {describe, expect, it} from "../../../../src/testing/test.js"
import backendProjects from "../../../dummy/src/config/backend-projects.js"
import Cli from "../../../../src/cli/index.js"
import Configuration from "../../../../src/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
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
    const userPath = `${dummyDirectory()}/src/frontend-models/user.js`
    const taskContents = await fs.readFile(taskPath, "utf8")
    const userContents = await fs.readFile(userPath, "utf8")

    expect(taskContents).toContain("class Task extends FrontendModelBase")
    expect(taskContents).toContain("path: \"/api/frontend-models/tasks\"")
    expect(taskContents).toContain("\"index\":\"list\"")
    expect(taskContents).toContain("@typedef {object} TaskAttributes")
    expect(taskContents).toContain("@returns {TaskAttributes[\"identifier\"]} - Attribute value.")
    expect(taskContents).toContain("identifier() { return this.readAttribute(\"identifier\") }")
    expect(taskContents).toContain("setIdentifier(newValue) { return this.setAttribute(\"identifier\", newValue) }")

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
})
