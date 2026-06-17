// @ts-check

import {describe, expect, it} from "../../../../src/testing/test.js"
import backendProjects from "../../../dummy/src/config/backend-projects.js"
import Cli from "../../../../src/cli/index.js"
import Configuration from "../../../../src/configuration.js"
import DatabaseRecord from "../../../../src/database/record/index.js"
import DbGenerateFrontendModels from "../../../../src/environment-handlers/node/cli/commands/generate/frontend-models.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import FrontendModelBaseResource from "../../../../src/frontend-model-resource/base-resource.js"
import fs from "fs/promises"
import os from "os"
import path from "node:path"
import TableColumn from "../../../../src/database/table-data/table-column.js"
import * as ts from "typescript"

class Call extends DatabaseRecord {
  /** @returns {number | null} */
  ea() { return this.readAttribute("ea") }
}

class CallFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Call

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

class InferredCallFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Call

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: [
        "id",
        {name: "startedAt", selectedByDefault: false},
        {name: "durationSeconds", selectedByDefault: false},
        {name: "metadata", selectedByDefault: false},
        {name: "active", selectedByDefault: false},
        {name: "eA", selectedByDefault: false}
      ]
    }
  }
}

class TranslatedCall extends DatabaseRecord {}
TranslatedCall.translates("title")
const TranslatedCallTranslation = TranslatedCall.getTranslationClass()

class TranslatedCallFrontendResource extends FrontendModelBaseResource {
  static ModelClass = TranslatedCall
  static translatedAttributes = ["title"]

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: ["id", {name: "title", selectedByDefault: false}]
    }
  }
}

class UninferableCallFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Call

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: ["unknownComputed"]
    }
  }
}

class MissingAbilitiesTaskFrontendResource extends FrontendModelBaseResource {
  static ModelClass = backendProjects[0].frontendModels.Task.ModelClass

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
      attributes: {
        id: {type: "integer"},
        name: {type: "varchar", null: true}
      },
      relationships: ["project"]
    }
  }
}

class NullableIdCallFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Call

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: {id: {type: "uuid", null: true}}
    }
  }
}

class CommandReturnTypeFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Call

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: {id: {type: "uuid"}},
      memberCommands: [
        "ping",
        {name: "refresh", args: [{name: "age", type: "number"}], returnType: "{refreshedAt: string}"}
      ]
    }
  }
}

// An abstract base resource other resources extend — deliberately has no static
// ModelClass, like an app's shared `BaseResource`.
class AbstractBaseFrontendResource extends FrontendModelBaseResource {
  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {attributes: []}
  }
}

class User extends DatabaseRecord {}
User.setPrimaryKey("reference")

class ReferenceUserFrontendResource extends FrontendModelBaseResource {
  static ModelClass = User

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: [
        {name: "reference", type: "varchar"},
        {name: "email", type: "varchar"}
      ]
    }
  }
}

class LegacyPrimaryKeyUser extends DatabaseRecord {}
LegacyPrimaryKeyUser.setPrimaryKey("LegacyID")

class LegacyPrimaryKeyUserFrontendResource extends FrontendModelBaseResource {
  static ModelClass = LegacyPrimaryKeyUser

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: [
        {name: "legacyID", type: "integer"},
        {name: "email", type: "varchar"}
      ]
    }
  }
}

class ConfiguredPrimaryKeyUser extends DatabaseRecord {}
ConfiguredPrimaryKeyUser.setPrimaryKey("LegacyID")

class ConfiguredPrimaryKeyUserFrontendResource extends FrontendModelBaseResource {
  static ModelClass = ConfiguredPrimaryKeyUser

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      attributes: [
        {name: "legacyID", type: "integer"},
        {name: "email", type: "varchar"}
      ],
      primaryKey: "legacyID"
    }
  }
}

/** @returns {void} */
function configureCallColumns() {
  Call._initialized = true
  Call._columns = [
    new TableColumn("id", {null: false, type: "uuid"}),
    new TableColumn("started_at", {null: true, type: "datetime"}),
    new TableColumn("duration_seconds", {null: false, type: "integer"}),
    new TableColumn("metadata", {null: true, type: "json"}),
    new TableColumn("active", {null: false, type: "boolean"}),
    new TableColumn("EA", {null: true, type: "integer"})
  ]
  delete Call._columnsAsHash
  delete Call._columnTypeByName
  delete Call._columnNameToAttributeName
  Call._attributeNameToColumnName = {
    active: "active",
    durationSeconds: "duration_seconds",
    ea: "EA",
    id: "id",
    metadata: "metadata",
    startedAt: "started_at"
  }
}

/** @returns {void} */
function configureTranslatedCallColumns() {
  TranslatedCall._initialized = true
  TranslatedCall._columns = [
    new TableColumn("id", {null: false, type: "uuid"})
  ]
  TranslatedCall._attributeNameToColumnName = {
    id: "id"
  }
  delete TranslatedCall._columnsAsHash
  delete TranslatedCall._columnTypeByName
  delete TranslatedCall._columnNameToAttributeName

  TranslatedCallTranslation._initialized = true
  TranslatedCallTranslation._columns = [
    new TableColumn("id", {null: false, type: "uuid"}),
    new TableColumn("locale", {null: false, type: "varchar"}),
    new TableColumn("title", {null: true, type: "varchar"})
  ]
  TranslatedCallTranslation._attributeNameToColumnName = {
    id: "id",
    locale: "locale",
    title: "title"
  }
  delete TranslatedCallTranslation._columnsAsHash
  delete TranslatedCallTranslation._columnTypeByName
  delete TranslatedCallTranslation._columnNameToAttributeName
}

/** @returns {void} */
function configureLegacyPrimaryKeyUserColumns() {
  LegacyPrimaryKeyUser._initialized = true
  LegacyPrimaryKeyUser._columns = [
    new TableColumn("LegacyID", {null: false, type: "integer"}),
    new TableColumn("email", {null: false, type: "varchar"})
  ]
  LegacyPrimaryKeyUser._attributeNameToColumnName = {
    email: "email",
    legacyID: "LegacyID"
  }
  delete LegacyPrimaryKeyUser._columnsAsHash
  delete LegacyPrimaryKeyUser._columnTypeByName
  delete LegacyPrimaryKeyUser._columnNameToAttributeName
}

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
    expect(taskContents).toContain("@property {TaskAttributes[\"name\"] | null} [name] - Permitted name value.")
    expect(taskContents).toContain("@property {TaskAttributes[\"isDone\"] | null} [isDone] - Permitted isDone value.")
    expect(taskContents).toContain("@property {string | null} [downloadToken] - Permitted downloadToken value.")
    expect(taskContents).not.toContain("[is_done]")
    expect(taskContents).toContain("@property {string | null} nameUppercase - Attribute value.")
    expect(taskContents).toContain("@property {string | null} asyncNameUppercase - Attribute value.")
    expect(taskContents).toContain("@property {null} downloadToken - Attribute value.")
    expect(taskContents).not.toContain("@property {Promise<string | null>} asyncNameUppercase - Attribute value.")
    expect(taskContents).not.toContain("@property {FrontendModelAttributeValue} nameUppercase - Attribute value.")
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
    expect(taskContents).toContain("setIdentifier(newValue) { return /** @type {TaskAttributes[\"identifier\"] | null} */ (this.setAttribute(\"identifier\", newValue)) }")
    expect(taskContents).toContain("setDownloadToken(newValue) { return /** @type {string | null} */ (this.setAttribute(\"downloadToken\", newValue)) }")
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
    expect(userContents).toContain("setEmail(newValue) { return /** @type {UserAttributes[\"email\"] | null} */ (this.setAttribute(\"email\", newValue)) }")
    expect(userContents).toContain("@typedef {Record<string, never>} UserCreateAttributes")
    expect(userContents).toContain("@typedef {Record<string, never>} UserUpdateAttributes")
    expect(userContents).not.toContain("@typedef {object} UserCreateAttributes")
    expect(userContents).not.toContain("@typedef {object} UserUpdateAttributes")
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
        await Task.create({name: null})
        await Task.create({downloadToken: "download-token"})
        // @ts-expect-error unknown create attributes must stay rejected
        await Task.create({typo: "Generated typing works"})
        // @ts-expect-error read-only create attributes must stay rejected
        await Task.create({id: "read-only"})
        // @ts-expect-error write-only setter JSDoc must keep string typing
        await Task.create({downloadToken: {token: "bad"}})

        const task = new Task()
        task.setId(null)
        task.setDownloadToken("download-token")
        task.setDownloadToken(null)
        // @ts-expect-error write-only generated setter must reject object values
        task.setDownloadToken({token: "bad"})
        await task.update({name: "Generated typing works"})
        await task.update({isDone: null})
        await task.update({downloadToken: null})
        // @ts-expect-error unknown update attributes must stay rejected
        await task.update({typo: "Generated typing works"})

        const users = await User.where({email: "generated@example.com"}).toArray()
        for (const loadedUser of users) {
          loadedUser.email()
        }
        await User.findBy({email: "generated@example.com"})

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

    configureCallColumns()

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

  it("infers typed attribute typedefs from backend model columns for configured attribute entries", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    configureCallColumns()

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            Call: InferredCallFrontendResource
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
    expect(callContents).toContain("@property {number | null} eA - Attribute value.")
  })

  it("infers translated attribute typedefs from translation table columns", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    configureTranslatedCallColumns()

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            TranslatedCall: TranslatedCallFrontendResource
          }
        }],
        initializeModels: async ({configuration}) => {
          TranslatedCall._configuration = configuration
          TranslatedCallTranslation._configuration = configuration
        }
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const callContents = await fs.readFile(`${dummyDirectory()}/src/frontend-models/translated-call.js`, "utf8")

    expect(callContents).toContain("@property {string | null} title - Attribute value.")
  })

  it("infers resource attribute typedefs from backend project source roots before backend model columns", async () => {
    const temporaryDirectory = path.resolve(dummyDirectory(), "../tmp/frontend-model-backend-source-root")
    const backendDirectory = `${temporaryDirectory}/backend`
    const outputDirectory = `${temporaryDirectory}/output`
    const resourcesDirectory = `${backendDirectory}/src/resources`
    const repositoryDirectory = path.resolve(dummyDirectory(), "../..")

    await fs.rm(temporaryDirectory, {force: true, recursive: true})
    await fs.mkdir(resourcesDirectory, {recursive: true})
    await fs.writeFile(`${resourcesDirectory}/report-resource.js`, `// @ts-check

import DatabaseRecord from "${repositoryDirectory}/src/database/record/index.js"
import FrontendModelBaseResource from "${repositoryDirectory}/src/frontend-model-resource/base-resource.js"
import TableColumn from "${repositoryDirectory}/src/database/table-data/table-column.js"

class Report extends DatabaseRecord {}
Report._initialized = true
Report._columns = [
  new TableColumn("id", {null: false, type: "uuid"}),
  new TableColumn("status_code", {null: false, type: "integer"})
]
Report._attributeNameToColumnName = {
  id: "id",
  statusCode: "status_code"
}

export default class ReportResource extends FrontendModelBaseResource {
  static ModelClass = Report

  /** @returns {import("${repositoryDirectory}/src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: ["read"],
      attributes: ["id", "statusCode"]
    }
  }

  /**
   * Formats the numeric status code for frontend display.
   * @param {Report} model - Report model.
   * @returns {string}
   */
  statusCodeAttribute(model) {
    void model
    return "HTTP 200"
  }
}
`)

    try {
      const cli = new Cli({
        configuration: buildConfiguration({
          backendProjectsList: [{
            path: backendDirectory,
            frontendModelsOutputPath: outputDirectory
          }]
        }),
        directory: dummyDirectory(),
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["g:frontend-models"],
        testing: true
      })

      await cli.execute()

      const reportContents = await fs.readFile(`${outputDirectory}/src/frontend-models/report.js`, "utf8")

      expect(reportContents).toContain("@property {string} statusCode - Attribute value.")
      expect(reportContents).not.toContain("@property {number} statusCode - Attribute value.")
    } finally {
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("fails when a frontend attribute cannot be inferred from a column or resource method JSDoc", async () => {
    configureCallColumns()

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            Call: UninferableCallFrontendResource
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

    await expect(async () => {
      await cli.execute()
    }).toThrow(/Could not infer JSDoc type for frontend model attribute 'Call#unknownComputed'/)
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

    expect(userContents).toContain("@property {string} reference - Attribute value.")
    expect(userContents).toContain("primaryKey: \"reference\"")
  })

  it("generates frontend-model primary keys from resolved frontend attribute names", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})
    configureLegacyPrimaryKeyUserColumns()

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            LegacyPrimaryKeyUser: LegacyPrimaryKeyUserFrontendResource
          }
        }],
        initializeModels: async ({configuration}) => {
          configuration.registerModelClass(LegacyPrimaryKeyUser)
        }
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const userContents = await fs.readFile(`${dummyDirectory()}/src/frontend-models/legacy-primary-key-user.js`, "utf8")

    expect(userContents).toContain("@property {number} legacyID - Attribute value.")
    expect(userContents).toContain("primaryKey: \"legacyID\"")
    expect(userContents).not.toContain("primaryKey: \"LegacyID\"")
  })

  it("honors configured frontend-model primary key attribute names", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            ConfiguredPrimaryKeyUser: ConfiguredPrimaryKeyUserFrontendResource
          }
        }],
        initializeModels: async ({configuration}) => {
          configuration.registerModelClass(ConfiguredPrimaryKeyUser)
        }
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const userContents = await fs.readFile(`${dummyDirectory()}/src/frontend-models/configured-primary-key-user.js`, "utf8")

    expect(userContents).toContain("@property {number} legacyID - Attribute value.")
    expect(userContents).toContain("primaryKey: \"legacyID\"")
    expect(userContents).not.toContain("primaryKey: \"LegacyID\"")
  })

  it("emits nestedAttributes relationship names extracted from permittedParams into the generated frontend-model resourceConfig", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    /** Resource that opts in to nested writes for two relationships through permittedParams. */
    class ProjectWithNestedResource extends FrontendModelBaseResource {
      static ModelClass = backendProjects[0].frontendModels.Project.ModelClass

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
        return {
          attributes: {
            id: {type: "integer"},
            name: {type: "varchar", null: true}
          }
        }
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

  it("types a custom command's args and response from a {name, args, returnType} command entry", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {Call: CommandReturnTypeFrontendResource}
        }]
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    await cli.execute()

    const callContents = await fs.readFile(`${dummyDirectory()}/src/frontend-models/call.js`, "utf8")

    // Object entry: named typed arg + declared return type.
    expect(callContents).toContain("async refresh(age) {")
    expect(callContents).toContain("@param {number} age - Command argument.")
    expect(callContents).toContain("@returns {Promise<{refreshedAt: string}>} - Command response.")
    expect(callContents).toContain("normalizeCustomCommandPayloadArguments([age])")
    // Plain string entry stays variadic with the generic response type.
    expect(callContents).toContain("async ping(...commandArguments) {")
    expect(callContents).toContain("@returns {Promise<Record<string, ?>>} - Command response.")

    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})
  })

  it("generates configured resources even when an abstract base resource without a ModelClass is registered", async () => {
    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})

    const cli = new Cli({
      configuration: buildConfiguration({
        backendProjectsList: [{
          path: "/tmp/backend",
          frontendModels: {
            AbstractBase: AbstractBaseFrontendResource,
            Call: CallFrontendResource
          }
        }]
      }),
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:frontend-models"],
      testing: true
    })

    // Must not throw "AbstractBase requires a static ModelClass" — the abstract
    // base is treated as resource-less and the real resource still generates.
    await cli.execute()

    const callContents = await fs.readFile(`${dummyDirectory()}/src/frontend-models/call.js`, "utf8")

    expect(callContents).toContain("class Call extends FrontendModelBase")

    await fs.rm(`${dummyDirectory()}/src/frontend-models`, {force: true, recursive: true})
  })

  it("skips a class whose body can't be brace-matched instead of aborting the whole generation", () => {
    const configuration = /** @type {any} */ ({getEnvironmentHandler: () => ({})})
    const command = new DbGenerateFrontendModels({args: {configuration}, cli: /** @type {any} */ (null)})
    // The redact() body contains a regex literal with quote characters; the brace
    // matcher mis-tokenizes the quotes as string delimiters and can't find the
    // closing brace. The class after it must still be processed.
    const sourceText = [
      "class RedactingResource {",
      "  /** @returns {string} */",
      "  redact(value) {",
      "    return value.replace(/(token\\s*[=:]\\s*)(\"?)[^\\s\"']+\\2/gi, \"$1$2[REDACTED]$2\")",
      "  }",
      "}",
      "",
      "class CleanResource {",
      "  /** @returns {Promise<number>} */",
      "  index() { return Promise.resolve(1) }",
      "}"
    ].join("\n")
    const returnTypes = new Map()

    command.addResourceMethodReturnTypesFromSource({returnTypes, sourceText})

    expect(returnTypes.get("CleanResource.index")).toEqual("Promise<number>")
  })
})
