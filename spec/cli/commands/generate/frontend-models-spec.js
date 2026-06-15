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
import os from "os"
import path from "node:path"
import TableColumn from "../../../../src/database/table-data/table-column.js"
import * as ts from "typescript"

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
 * Typechecks source text and fails on diagnostics matched by the filter.
 * @param {string} sourceText - Source text to check.
 * @param {string} tmpPrefix - Temporary directory prefix.
 * @param {function({diagnostic: ts.Diagnostic, sourcePath: string}): boolean} diagnosticFilter - Relevant diagnostic filter.
 * @returns {Promise<void>}
 */
async function expectSourceTypechecks(sourceText, tmpPrefix, diagnosticFilter) {
  const tmpDirectory = await fs.mkdtemp(path.join(os.tmpdir(), tmpPrefix))
  const sourcePath = `${tmpDirectory}/index.js`
  await fs.writeFile(sourcePath, sourceText)

  const program = ts.createProgram([sourcePath], {
    allowJs: true,
    checkJs: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2024
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  const relevantDiagnostics = diagnostics.filter((diagnostic) => diagnosticFilter({diagnostic, sourcePath}))

  expect(relevantDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([])
}

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
    expect(taskContents).toContain("@typedef {import(\"../../../../src/frontend-models/base.js\").FrontendModelAttributeValue} FrontendModelAttributeValue")
    expect(taskContents).not.toContain("FrontendModelTransportValue")
    expect(taskContents).toContain("/** @returns {FrontendModelResourceConfig} - Resource config. */")
    expect(taskContents).not.toContain("path:")
    expect(taskContents).toContain("attributes: [\n")
    expect(taskContents).toContain("      \"id\",\n")
    expect(taskContents).toContain("      \"identifier\",\n")
    expect(taskContents).toContain("      \"name\",\n")
    expect(taskContents).not.toContain("builtInCollectionCommands")
    expect(taskContents).not.toContain("builtInMemberCommands")
    expect(taskContents).toContain("@typedef {object} TaskAttributes")
    expect(taskContents).toContain("@typedef {object} TaskCreateAttributes")
    expect(taskContents).toContain("@property {TaskAttributes[\"name\"]} [name] - Permitted name value.")
    expect(taskContents).toContain("@property {TaskAttributes[\"isDone\"]} [isDone] - Permitted isDone value.")
    expect(taskContents).not.toContain("[is_done]")
    expect(taskContents).toContain("@property {FrontendModelAttributeValue} [descriptionFile] - Permitted descriptionFile value.")
    expect(taskContents).toContain("@typedef {object} TaskUpdateAttributes")
    expect(taskContents).toContain("@augments {FrontendModelBase<TaskAttributes, TaskCreateAttributes, TaskUpdateAttributes>}")
    expect(taskContents).toContain("export {Task}")
    expect(taskContents).toContain("export default Task")
    expect(taskContents).not.toContain("export default /** @type")
    expect(taskContents).not.toContain("static async create(attributes = {})")
    expect(taskContents).not.toContain("async update(newAttributes = {})")
    expect(taskContents).not.toContain("_createAttributesType")
    expect(taskContents).not.toContain("_updateAttributesType")
    expect(taskContents).toContain("/** @returns {TaskAttributes[\"identifier\"]} - Attribute value. */")
    expect(taskContents).toContain("@returns {TaskAttributes[\"identifier\"]} - Attribute value.")
    expect(taskContents).toContain("identifier() { return /** @type {TaskAttributes[\"identifier\"]} */ (this.readAttribute(\"identifier\")) }")
    expect(taskContents).toContain("setIdentifier(newValue) { return /** @type {TaskAttributes[\"identifier\"]} */ (this.setAttribute(\"identifier\", newValue)) }")
    expect(taskContents).not.toContain("import Project from")
    expect(taskContents).toContain("/** @returns {Record<string, {type: \"belongsTo\" | \"hasOne\" | \"hasMany\", autoload?: boolean}>} - Relationship definitions. */")
    expect(taskContents).toContain("static relationshipDefinitions()")
    expect(taskContents).toContain("project: \"Project\",")
    expect(taskContents).toContain("FrontendModelBase.registerModel(Task)")
    expect(taskContents).toContain("project: {type: \"belongsTo\"}")
    expect(taskContents).toContain("projectRelationship() { return /** @type {import(\"../../../../src/frontend-models/base.js\").FrontendModelSingularRelationship<Task, import(\"./project.js\").Project, import(\"./project.js\").ProjectCreateAttributes>} */ (this.getRelationshipByName(\"project\")) }")
    expect(taskContents).toContain("project() { return this.projectRelationship().loaded() }")
    expect(taskContents).toContain("@param {import(\"./project.js\").ProjectCreateAttributes} [attributes] - Attributes for the new related model.")
    expect(taskContents).toContain("async loadProject() { return await this.projectRelationship().load() }")
    expect(taskContents).toContain("async projectOrLoad() { return await this.projectRelationship().orLoad() }")
    expect(taskContents).toContain("* @returns {void}\n   */\n  setProject(model) { this.projectRelationship().setLoaded(model) }")
    expect(taskContents).not.toContain("Record<string, ?>")
    expect(taskContents).not.toContain("...?")

    expect(projectContents).not.toContain("import Task from")
    expect(projectContents).toContain("@typedef {object} ProjectTasksNestedAttributes")
    expect(projectContents).toContain("@property {FrontendModelAttributeValue} [name] - Nested name value.")
    expect(projectContents).toContain("@property {Array<ProjectTasksNestedAttributes>} [tasksAttributes] - Permitted nested tasksAttributes values.")
    expect(projectContents).toContain("tasks: \"Task\",")
    expect(projectContents).toContain("FrontendModelBase.registerModel(Project)")
    expect(projectContents).toContain("tasks: {type: \"hasMany\"}")
    expect(projectContents).toContain("tasksRelationship() { return /** @type {import(\"../../../../src/frontend-models/base.js\").FrontendModelHasManyRelationship<Project, import(\"./task.js\").Task, import(\"./task.js\").TaskCreateAttributes>} */ (this.getRelationshipByName(\"tasks\")) }")
    expect(projectContents).toContain("tasks() { return this.tasksRelationship() }")
    expect(projectContents).toContain("tasksLoaded() { return this.tasksRelationship().loaded() }")
    expect(projectContents).toContain("async loadTasks() { return await this.tasksRelationship().load() }")
    expect(projectContents).not.toContain("Record<string, ?>")
    expect(projectContents).not.toContain("...?")

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
    expect(userContents).toContain("      collectionCommands: [\n")
    expect(userContents).toContain("        \"lookupByEmail\",\n")
    expect(userContents).toContain("      memberCommands: [\n")
    expect(userContents).toContain("        \"refreshProfile\",\n")
    expect(userContents).toContain("static async lookupByEmail(...commandArguments)")
    expect(userContents).toContain("payload: User.normalizeCustomCommandPayloadArguments(commandArguments)")
    expect(userContents).toContain("commandName: \"lookup-by-email\"")
    expect(userContents).toContain("async refreshProfile(...commandArguments)")
    expect(userContents).toContain("payload: User.normalizeCustomCommandPayloadArguments(commandArguments)")
    expect(userContents).toContain("commandName: \"refresh-profile\"")
    expect(userContents).toContain("email() { return /** @type {UserAttributes[\"email\"]} */ (this.readAttribute(\"email\")) }")
    expect(userContents).toContain("setEmail(newValue) { return /** @type {UserAttributes[\"email\"]} */ (this.setAttribute(\"email\", newValue)) }")
  })

  it("keeps generated frontend write attributes on inherited create and update", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({backendProjectsList: backendProjects}),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const sourceText = `
      import Task from "${dummyDirectory()}/src/frontend-models/task.js"
      import User from "${dummyDirectory()}/src/frontend-models/user.js"

      async function checkWrites() {
        await Task.create({name: "Generated typing works"})
        // @ts-expect-error unknown create attributes must stay rejected
        await Task.create({typo: "Generated typing works"})
        // @ts-expect-error read-only create attributes must stay rejected
        await Task.create({id: "read-only"})

        const task = new Task()
        await task.update({name: "Generated typing works"})
        // @ts-expect-error unknown update attributes must stay rejected
        await task.update({typo: "Generated typing works"})

        await User.create()
        await User.create({})
        // @ts-expect-error empty create attributes must reject model fields
        await User.create({email: "generated@example.com"})

        const user = new User()
        await user.update({})
        // @ts-expect-error empty update attributes must reject model fields
        await user.update({email: "generated@example.com"})
      }

      checkWrites()
    `

    await expectSourceTypechecks(sourceText, "velocious-frontend-write-attributes-type-check-", ({diagnostic, sourcePath}) => {
      const fileName = diagnostic.file?.fileName || ""

      return fileName === sourcePath
        || fileName.includes("/src/frontend-models/base.js")
        || fileName.includes("/spec/dummy/src/frontend-models/task.js")
        || fileName.includes("/spec/dummy/src/frontend-models/user.js")
    })
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

    expect(callContents).toContain("@typedef {import(\"../../../../src/frontend-models/base.js\").FrontendModelTransportValue} FrontendModelTransportValue")
    expect(callContents).toContain("@property {string} id - Attribute value.")
    expect(callContents).toContain("@property {Date | null} startedAt - Attribute value.")
    expect(callContents).toContain("@property {number} durationSeconds - Attribute value.")
    expect(callContents).toContain("@property {FrontendModelTransportValue | null} metadata - Attribute value.")
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
    expect(callContents).toContain("@property {FrontendModelTransportValue | null} metadata - Attribute value.")
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

  it("emits nestedAttributes relationship names extracted from permittedParams into the generated frontend-model resourceConfig", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    /** Resource that opts in to nested writes for two relationships through permittedParams. */
    class ProjectWithNestedResource extends FrontendModelBaseResource {
      /** @returns {Array<string | Record<string, Array<string>>>} */
      permittedParams() {
        return [
          "name",
          {tasksAttributes: ["id", "_destroy", "name"]},
          {commentsAttributes: ["body"]}
        ]
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
    expect(projectContents).toContain("tasks: {}")
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

    expect(userContents).not.toContain("nestedAttributes:")
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

  it("allows the same frontend model class name in different output directories", async () => {
    const firstOutputDirectory = path.resolve(dummyDirectory(), "../tmp/frontend-model-output-one")
    const secondOutputDirectory = path.resolve(dummyDirectory(), "../tmp/frontend-model-output-two")
    await fs.rm(firstOutputDirectory, {force: true, recursive: true})
    await fs.rm(secondOutputDirectory, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [
          {
            path: "/tmp/backend-one",
            frontendModels: {
              User: ReferenceUserFrontendResource
            },
            frontendModelsOutputPath: firstOutputDirectory
          },
          {
            path: "/tmp/backend-two",
            frontendModels: {
              User: ReferenceUserFrontendResource
            },
            frontendModelsOutputPath: secondOutputDirectory
          }
        ],
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

    const firstUserContents = await fs.readFile(`${firstOutputDirectory}/src/frontend-models/user.js`, "utf8")
    const secondUserContents = await fs.readFile(`${secondOutputDirectory}/src/frontend-models/user.js`, "utf8")

    expect(firstUserContents).toContain("class User extends FrontendModelBase")
    expect(secondUserContents).toContain("class User extends FrontendModelBase")

    await fs.rm(firstOutputDirectory, {force: true, recursive: true})
    await fs.rm(secondOutputDirectory, {force: true, recursive: true})
  })

  it("detects duplicate model names when two projects target the same directory spelled differently", async () => {
    const outputDirectory = path.resolve(dummyDirectory(), "../tmp/frontend-model-output-canonical")
    await fs.rm(outputDirectory, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [
          {
            path: "/tmp/backend-one",
            frontendModels: {
              User: ReferenceUserFrontendResource
            },
            frontendModelsOutputPath: outputDirectory
          },
          {
            path: "/tmp/backend-two",
            frontendModels: {
              User: ReferenceUserFrontendResource
            },
            // Same directory as above, spelled with a redundant "." segment and a trailing slash.
            frontendModelsOutputPath: `${outputDirectory}/./`
          }
        ],
        initializeModels: async ({configuration}) => {
          configuration.registerModelClass(User)
        }
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await expect(async () => {
      await cli.execute()
    }).toThrow(/Duplicate frontend model definition for 'User'/)

    await fs.rm(outputDirectory, {force: true, recursive: true})
  })
})
