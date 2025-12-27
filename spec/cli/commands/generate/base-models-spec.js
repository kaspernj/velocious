import {describe, expect, it} from "../../../../src/testing/test.js"
import Cli from "../../../../src/cli/index.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import * as ts from "typescript"

describe("Cli - generate - base-models", () => {
  it("generates base models with valid JSDoc casts", async () => {
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
    const contents = await fs.readFile(userBasePath, "utf8")

    expect(contents.includes("/unknownunknown")).toEqual(false)
    expect(contents.includes("return /** @type {typeof import")).toEqual(true)

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
})
