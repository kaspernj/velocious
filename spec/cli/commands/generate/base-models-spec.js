import {describe, expect, it} from "../../../../src/testing/test.js"
import Cli from "../../../../src/cli/index.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import os from "os"
import path from "path"
import fs from "fs/promises"
import * as ts from "typescript"

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

describe("Cli - generate - base-models", () => {
  it("generates base models with valid JSDoc casts", {tags: ["mssql"]}, async () => {
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:base-models"],
      testing: true
    })

    await cli.execute()

    const userBasePath = `${dummyDirectory()}/src/model-bases/user.js`
    const userModelPath = `${dummyDirectory()}/src/models/user.js`
    const program = ts.createProgram([userBasePath, userModelPath], {
      allowJs: true,
      checkJs: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2024
    })
    const checker = program.getTypeChecker()
    const source = program.getSourceFile(userBasePath)

    if (!source) throw new Error("Could not load generated base model source file")

    let classNode
    let methodNode

    ts.forEachChild(source, (node) => {
      if (ts.isClassDeclaration(node) && node.name?.text === "UserBase") {
        classNode = node
      }
    })

    if (!classNode) throw new Error("Could not find UserBase class in generated base model")

    ts.forEachChild(classNode, (node) => {
      if (ts.isMethodDeclaration(node) && node.name?.getText(source) === "getModelClass") {
        methodNode = node
      }
    })

    if (!methodNode) throw new Error("Could not find getModelClass in generated base model")

    const signature = checker.getSignatureFromDeclaration(methodNode)
    const returnType = signature ? checker.typeToString(signature.getReturnType()) : ""

    expect(returnType).toEqual("typeof User")
  })

  it("generates boolean attribute types in base models", {tags: ["mssql"]}, async () => {
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:base-models"],
      testing: true
    })

    await cli.execute()

    const taskBasePath = `${dummyDirectory()}/src/model-bases/task.js`
    const projectDetailBasePath = `${dummyDirectory()}/src/model-bases/project-detail.js`
    const taskContents = await fs.readFile(taskBasePath, "utf8")
    const projectDetailContents = await fs.readFile(projectDetailBasePath, "utf8")
    const databaseType = dummyConfiguration.getDatabaseType()
    const expectedType = databaseType == "mssql" ? "number" : "boolean"

    const returnPattern = new RegExp(`@returns \\{${expectedType} \\| null\\}[\\s\\S]*?isDone\\(\\)`)
    const setterPattern = new RegExp(`@param \\{${expectedType} \\| null\\} newValue[\\s\\S]*?setIsDone\\(`)
    const activeReturnPattern = new RegExp(`@returns \\{${expectedType} \\| null\\}[\\s\\S]*?isActive\\(\\)`)
    const activeSetterPattern = new RegExp(`@param \\{${expectedType} \\| null\\} newValue[\\s\\S]*?setIsActive\\(`)

    expect(returnPattern.test(taskContents)).toBeTrue()
    expect(setterPattern.test(taskContents)).toBeTrue()
    expect(activeReturnPattern.test(projectDetailContents)).toBeTrue()
    expect(activeSetterPattern.test(projectDetailContents)).toBeTrue()
    expect(taskContents).toContain("@typedef {object} TaskWriteAttributes")
    expect(taskContents).toContain("@property {number} [id] - Value for the id attribute.")
    expect(taskContents).toContain("@property {Date | string | null} [createdAt] - Value for the createdAt attribute.")
    expect(taskContents).toContain("@property {Array<import(\"./comment.js\").CommentWriteAttributes & {_destroy?: boolean}>} [commentsAttributes] - Nested comments attributes.")
    expect(taskContents).toContain("@property {import(\"./project.js\").ProjectWriteAttributes} [projectAttributes] - Nested project attributes.")
    expect(taskContents).toContain("/** @augments {DatabaseRecord<TaskWriteAttributes>} */")
    expect(taskContents).not.toContain("static async create(attributes)")
    expect(taskContents).not.toContain("async update(attributes)")
    expect(taskContents).not.toContain("_writeAttributesType")
    expect(taskContents).not.toContain("@returns {Promise<DatabaseRecord>} - Persisted record.")
    expect(taskContents).not.toContain("@param {Record<string, ?>} [attributes] - Attributes for the new record.")
  })

  it("keeps generated backend write attributes on inherited create and update", {tags: ["mssql"]}, async () => {
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:base-models"],
      testing: true
    })

    await cli.execute()

    const sourceText = `
      import Task from "${dummyDirectory()}/src/models/task.js"

      async function checkWrites() {
        await Task.create({name: "Generated typing works"})
        // @ts-expect-error unknown create attributes must stay rejected
        await Task.create({typo: "Generated typing works"})

        const task = new Task()
        await task.update({name: "Generated typing works"})
        // @ts-expect-error unknown update attributes must stay rejected
        await task.update({typo: "Generated typing works"})
      }

      checkWrites()
    `

    await expectSourceTypechecks(sourceText, "velocious-backend-write-attributes-type-check-", ({diagnostic, sourcePath}) => diagnostic.file?.fileName === sourcePath)
  })

  it("infers concrete model types in lifecycle callbacks", {tags: ["mssql"]}, async () => {
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["g:base-models"],
      testing: true
    })

    await cli.execute()

    const sourceText = `
      import Task from "${dummyDirectory()}/src/models/task.js"

      Task.beforeValidation((task) => {
        task.name()
      })
    `
    await expectSourceTypechecks(sourceText, "velocious-lifecycle-callback-type-check-", ({diagnostic, sourcePath}) => {
      const fileName = diagnostic.file?.fileName || ""

      return fileName === sourcePath || fileName.includes("src/database/record/index.js")
    })
  })

  it("accepts concrete frontend-model resources in typed registries", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../../../..")
    const sourceText = `
      // @ts-check

      /** @import {FrontendModelResourceClassType} from "${projectRoot}/src/configuration-types.js" */

      import FrontendModelBaseResource from "${projectRoot}/src/frontend-model-resource/base-resource.js"

      class ProjectResource extends FrontendModelBaseResource {}

      /** @type {Record<string, FrontendModelResourceClassType>} */
      const typedResources = {
        Project: ProjectResource
      }

      typedResources.Project
    `
    await expectSourceTypechecks(sourceText, "velocious-resource-class-type-check-", ({diagnostic, sourcePath}) => diagnostic.file?.fileName === sourcePath)
  })
})
