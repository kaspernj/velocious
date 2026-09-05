// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {typescriptCliDiagnostics} from "../helpers/typescript-cli-helpers.js"

describe("FrontendModelBase types", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("accepts composite identities in the static find wrapper", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..")
    const tmpDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-frontend-model-find-type-check-"))
    const sourcePath = `${tmpDirectory}/index.js`
    const sourceText = `
      // @ts-check

      import FrontendModelBase from "${projectRoot}/build/src/frontend-models/base.js"

      class CompositeModel extends FrontendModelBase {}

      CompositeModel.find({externalId: 7, tenantId: "tenant-1"})
    `

    await fs.writeFile(sourcePath, sourceText)

    const diagnostics = await typescriptCliDiagnostics([sourcePath])
    const sourceDiagnostics = diagnostics.filter((diagnostic) => diagnostic.file?.fileName === sourcePath)

    expect(sourceDiagnostics.map((diagnostic) => diagnostic.messageText)).toEqual([])
  })

  it("preserves concrete primary key types in lifecycle event callbacks", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..")
    const tmpDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-frontend-model-event-primary-key-type-check-"))
    const sourcePath = `${tmpDirectory}/index.js`
    const sourceText = `
      // @ts-check

      import FrontendModelBase from "${projectRoot}/build/src/frontend-models/base.js"

      /** @typedef {{id: string, name: string}} ScalarAttributes */
      /** @augments {FrontendModelBase<ScalarAttributes, ScalarAttributes, ScalarAttributes, string>} */
      class ScalarModel extends FrontendModelBase {}

      /** @typedef {{id: number, name: string}} NumericAttributes */
      /** @augments {FrontendModelBase<NumericAttributes, NumericAttributes, NumericAttributes, number, string>} */
      class NumericModel extends FrontendModelBase {}

      /** @typedef {{localId: number, tenantId: string}} CompositeAttributes */
      /** @typedef {{localId: number, tenantId: string}} CompositePrimaryKeyValue */
      /** @augments {FrontendModelBase<CompositeAttributes, CompositeAttributes, CompositeAttributes, CompositePrimaryKeyValue>} */
      class CompositeModel extends FrontendModelBase {}

      ScalarModel.onCreate(({id, model}) => {
        id.toUpperCase()
        model.primaryKeyValue().toUpperCase()
      })
      ScalarModel.onDestroy(({id}) => id.toUpperCase())

      NumericModel.onCreate(({id, model}) => {
        id.toUpperCase()
        model.primaryKeyValue().toFixed()
      })

      CompositeModel.onUpdate(({id, model}) => {
        id.localId.toFixed()
        id.tenantId.toUpperCase()
        model.primaryKeyValue().localId.toFixed()
      })
      CompositeModel.onDestroy(({id}) => id.tenantId.toUpperCase())

      /** @param {{onDestroy(callback: (event: {id: string}) => void): Promise<() => void>}} ModelClass */
      function acceptScalarDestroyModelClass(ModelClass) {
        return ModelClass
      }

      acceptScalarDestroyModelClass(ScalarModel)
    `

    await fs.writeFile(sourcePath, sourceText)

    const diagnostics = await typescriptCliDiagnostics([sourcePath])
    const sourceDiagnostics = diagnostics.filter((diagnostic) => diagnostic.file?.fileName === sourcePath)

    expect(sourceDiagnostics.map((diagnostic) => diagnostic.messageText)).toEqual([])
  })
})
