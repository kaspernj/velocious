// @ts-check

import {describe, expect, it} from "../../../../src/testing/test.js"
import backendProjects from "../../../dummy/src/config/backend-projects.js"
import Cli from "../../../../src/cli/index.js"
import Configuration from "../../../../src/configuration.js"
import DatabaseRecord from "../../../../src/database/record/index.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import FrontendModelBaseResource from "../../../../src/frontend-model-resource/base-resource.js"
import fs from "fs/promises"
import path from "node:path"
import TableColumn from "../../../../src/database/table-data/table-column.js"

class CallFrontendResource extends FrontendModelBaseResource {
  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: {
        id: {type: "uuid"},
        startedAt: {type: "datetime", null: true},
        durationSeconds: {dataType: "integer"},
        metadata: {sqlType: "json", null: true},
        active: {type: "boolean"},
        endedAt: {type: "timestamp without time zone", null: true}
      }
    }
  }
}

class MissingAbilitiesTaskFrontendResource extends FrontendModelBaseResource {
  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: ["id", "name"]
    }
  }
}

class MissingRelationshipTargetTask extends DatabaseRecord {}
MissingRelationshipTargetTask.belongsTo("project")

class MissingRelationshipTargetTaskFrontendResource extends FrontendModelBaseResource {
  static ModelClass = MissingRelationshipTargetTask

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: ["id", "name"],
      relationships: ["project"]
    }
  }
}

class NullableIdCallFrontendResource extends FrontendModelBaseResource {
  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: {id: {type: "uuid", null: true}}
    }
  }
}

class ReferenceUserFrontendResource extends FrontendModelBaseResource {
  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: ["reference", "email"]
    }
  }
}

class User extends DatabaseRecord {}
User.setPrimaryKey("reference")

class Call extends DatabaseRecord {}

/**
 * @param {object} args - Build args.
 * @param {import("../../../../src/configuration-types.js").BackendProjectConfiguration[]} [args.backendProjectsList] - Backend projects.
 * @param {function({configuration: Configuration}) : Promise<void>} [args.initializeModels] - Model initializer.
 * @returns {Configuration} - Configuration instance.
 */
function buildConfiguration({backendProjectsList, initializeModels} = {}) {
  return new Configuration({
    backendProjects: backendProjectsList,
    database: {test: {}},
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: initializeModels || (async () => {}),
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
    expect(taskContents).toContain("@typedef {import(\"../../../../src/frontend-models/base.js\").FrontendModelResourceConfig} FrontendModelResourceConfig")
    expect(taskContents).toContain("/** @returns {FrontendModelResourceConfig} - Resource config. */")
    expect(taskContents.includes("path:")).toEqual(false)
    expect(taskContents).toContain("attributes: [\n")
    expect(taskContents).toContain("      \"id\",\n")
    expect(taskContents).toContain("      \"identifier\",\n")
    expect(taskContents).toContain("      \"name\",\n")
    expect(taskContents).toContain("      builtInCollectionCommands: {\n")
    expect(taskContents).toContain("        index: \"list\",\n")
    expect(taskContents.includes("      builtInMemberCommands: {\n")).toEqual(false)
    expect(taskContents).toContain("@typedef {object} TaskAttributes")
    expect(taskContents).toContain("/** @returns {TaskAttributes[\"identifier\"]} - Attribute value. */")
    expect(taskContents).toContain("@returns {TaskAttributes[\"identifier\"]} - Attribute value.")
    expect(taskContents).toContain("identifier() { return this.readAttribute(\"identifier\") }")
    expect(taskContents).toContain("setIdentifier(newValue) { return this.setAttribute(\"identifier\", newValue) }")
    expect(taskContents.includes("import Project from")).toEqual(false)
    expect(taskContents).toContain("/** @returns {Record<string, {type: \"belongsTo\" | \"hasOne\" | \"hasMany\"}>} - Relationship definitions. */")
    expect(taskContents).toContain("static relationshipDefinitions()")
    expect(taskContents).toContain("project: \"Project\",")
    expect(taskContents).toContain("FrontendModelBase.registerModel(Task)")
    expect(taskContents).toContain("project: {type: \"belongsTo\"}")
    expect(taskContents).toContain("project() { return /** @type {import(\"./project.js\").default | null} */ (this.getRelationshipByName(\"project\").loaded()) }")
    expect(taskContents).toContain("async loadProject() { return /** @type {Promise<import(\"./project.js\").default | null>} */ (this.loadRelationship(\"project\")) }")
    expect(taskContents).toContain("async projectOrLoad() { return /** @type {Promise<import(\"./project.js\").default | null>} */ (this.relationshipOrLoad(\"project\")) }")
    expect(taskContents).toContain("setProject(model) { return /** @type {import(\"./project.js\").default | null} */ (this.setRelationship(\"project\", model)) }")

    expect(projectContents.includes("import Task from")).toEqual(false)
    expect(projectContents).toContain("tasks: \"Task\",")
    expect(projectContents).toContain("FrontendModelBase.registerModel(Project)")
    expect(projectContents).toContain("tasks: {type: \"hasMany\"}")
    expect(projectContents).toContain("tasks() { return /** @type {import(\"../../../../src/frontend-models/base.js\").FrontendModelHasManyRelationship<typeof import(\"./project.js\").default, typeof import(\"./task.js\").default>} */ (this.getRelationshipByName(\"tasks\")) }")
    expect(projectContents).toContain("tasksLoaded() { return /** @type {Array<import(\"./task.js\").default>} */ (this.getRelationshipByName(\"tasks\").loaded()) }")
    expect(projectContents).toContain("async loadTasks() { return /** @type {Promise<Array<import(\"./task.js\").default>>} */ (this.loadRelationship(\"tasks\")) }")

    const indexPath = `${dummyDirectory()}/src/frontend-models/index.js`
    const indexContents = await fs.readFile(indexPath, "utf8")

    expect(indexContents).toContain("export {default as Comment} from \"./comment.js\"")
    expect(indexContents).toContain("export {default as Project} from \"./project.js\"")
    expect(indexContents).toContain("export {default as Task} from \"./task.js\"")
    expect(indexContents).toContain("export {default as User} from \"./user.js\"")

    const setupPath = `${dummyDirectory()}/src/frontend-models/setup.js`
    const setupContents = await fs.readFile(setupPath, "utf8")

    expect(setupContents).toContain("// This file is auto-generated by Velocious.")
    expect(setupContents).toContain("import \"./comment.js\"")
    expect(setupContents).toContain("import \"./project.js\"")
    expect(setupContents).toContain("import \"./task.js\"")
    expect(setupContents).toContain("import \"./user.js\"")

    expect(userContents).toContain("class User extends FrontendModelBase")
    expect(userContents).toContain("      collectionCommands: {\n")
    expect(userContents).toContain("        lookupByEmail: \"lookup-by-email\",\n")
    expect(userContents).toContain("      memberCommands: {\n")
    expect(userContents).toContain("        refreshProfile: \"refresh-profile\",\n")
    expect(userContents).toContain("static async lookupByEmail(...commandArguments)")
    expect(userContents).toContain("payload: User.normalizeCustomCommandPayloadArguments(commandArguments)")
    expect(userContents).toContain("commandName: \"lookup-by-email\"")
    expect(userContents).toContain("async refreshProfile(...commandArguments)")
    expect(userContents).toContain("payload: User.normalizeCustomCommandPayloadArguments(commandArguments)")
    expect(userContents).toContain("commandName: \"refresh-profile\"")
    expect(userContents).toContain("email() { return this.readAttribute(\"email\") }")
    expect(userContents).toContain("setEmail(newValue) { return this.setAttribute(\"email\", newValue) }")
  })

  it("generates typed attribute typedefs from attribute metadata", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            Call: CallFrontendResource
          }
        }]
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const callContents = await fs.readFile(`${dummyDirectory()}/src/frontend-models/call.js`, "utf8")

    expect(callContents).toContain("@property {string} id - Attribute value.")
    expect(callContents).toContain("@property {Date | null} startedAt - Attribute value.")
    expect(callContents).toContain("@property {number} durationSeconds - Attribute value.")
    expect(callContents).toContain("@property {Record<string, any> | null} metadata - Attribute value.")
    expect(callContents).toContain("@property {boolean} active - Attribute value.")
    expect(callContents).toContain("@property {Date | null} endedAt - Attribute value.")
  })

  it("infers typed attribute typedefs from backend model columns for array attributes", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    Call._initialized = true
    Call._columns = [
      new TableColumn("id", {null: false, type: "uuid"}),
      new TableColumn("started_at", {null: true, type: "datetime"}),
      new TableColumn("duration_seconds", {null: false, type: "integer"}),
      new TableColumn("metadata", {null: true, type: "json"}),
      new TableColumn("active", {null: false, type: "boolean"})
    ]
    Call._columnsAsHash = {}
    Call._columnTypeByName = {}
    Call._attributeNameToColumnName = {
      active: "active",
      durationSeconds: "duration_seconds",
      id: "id",
      metadata: "metadata",
      startedAt: "started_at"
    }

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            Call: CallFrontendResource
          }
        }],
        initializeModels: async ({configuration}) => {
          Call._configuration = configuration
        }
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const callContents = await fs.readFile(`${dummyDirectory()}/src/frontend-models/call.js`, "utf8")

    expect(callContents).toContain("@property {string} id - Attribute value.")
    expect(callContents).toContain("@property {Date | null} startedAt - Attribute value.")
    expect(callContents).toContain("@property {number} durationSeconds - Attribute value.")
    expect(callContents).toContain("@property {Record<string, any> | null} metadata - Attribute value.")
    expect(callContents).toContain("@property {boolean} active - Attribute value.")
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

  it("uses built-in default abilities when abilities config is omitted", async () => {
    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            Task: MissingAbilitiesTaskFrontendResource
          }
        }]
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()
  })

  it("fails when a relationship target has no frontend model resource", async () => {
    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            Task: MissingRelationshipTargetTaskFrontendResource
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

  it("treats null as the nullability source for typed attribute typedefs", async () => {
    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            Call: NullableIdCallFrontendResource
          }
        }]
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const callContents = await fs.readFile(`${dummyDirectory()}/src/frontend-models/call.js`, "utf8")

    expect(callContents).toContain("@property {string | null} id - Attribute value.")
  })

  it("generates frontend-model primary keys from backend model classes", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            User: ReferenceUserFrontendResource
          }
        }],
        initializeModels: async ({configuration}) => {
          configuration.registerModelClass(User)
        }
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const userContents = await fs.readFile(`${dummyDirectory()}/src/frontend-models/user.js`, "utf8")

    expect(userContents).toContain("primaryKey: \"reference\"")
  })

  it("emits nestedAttributes from the resource into the generated frontend-model resourceConfig", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    /** Resource that opts in to nested writes for two relationships with different policies. */
    class ProjectWithNestedResource extends FrontendModelBaseResource {
      static nestedAttributes = {
        tasks: {allowDestroy: true, limit: 50},
        comments: {}
      }

      /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
      static resourceConfig() {
        return {attributes: ["id", "name"]}
      }
    }

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            Project: ProjectWithNestedResource
          }
        }]
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const projectContents = await fs.readFile(`${dummyDirectory()}/src/frontend-models/project.js`, "utf8")

    expect(projectContents).toContain("nestedAttributes: {")
    expect(projectContents).toContain("tasks: {\"allowDestroy\":true,\"limit\":50}")
    expect(projectContents).toContain("comments: {}")
  })

  it("omits nestedAttributes block when the resource declares none", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            User: ReferenceUserFrontendResource
          }
        }],
        initializeModels: async ({configuration}) => {
          configuration.registerModelClass(User)
        }
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const userContents = await fs.readFile(`${dummyDirectory()}/src/frontend-models/user.js`, "utf8")

    expect(userContents.includes("nestedAttributes:")).toEqual(false)
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
