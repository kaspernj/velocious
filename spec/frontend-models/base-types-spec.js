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

      /** @augments {FrontendModelBase<ScalarAttributes, ScalarAttributes, ScalarAttributes, string>} */
      class GeneratedScalarModel extends FrontendModelBase {
        /**
         * @overload
         * @param {(event: {id: string}) => void} callback
         * @param {import("${projectRoot}/build/src/frontend-models/base.js").FrontendModelEventOptions} [options]
         * @returns {Promise<() => void>}
         */
        /**
         * @template {import("${projectRoot}/build/src/frontend-models/base.js").FrontendModelClass} T
         * @overload
         * @this {T}
         * @param {(event: {id: import("${projectRoot}/build/src/frontend-models/base.js").FrontendModelEventPrimaryKeyValueFor<InstanceType<T>>}) => void} callback
         * @param {import("${projectRoot}/build/src/frontend-models/base.js").FrontendModelEventOptions} [options]
         * @returns {Promise<() => void>}
         */
        /**
         * @param {(event: {id: never}) => void} callback
         * @param {import("${projectRoot}/build/src/frontend-models/base.js").FrontendModelEventOptions} [options]
         */
        static async onDestroy(callback, options = {}) {
          return await this._registerDestroyEventCallback(callback, options)
        }
      }

      /** @augments {FrontendModelBase<CompositeAttributes, CompositeAttributes, CompositeAttributes, CompositePrimaryKeyValue>} */
      class GeneratedCompositeModel extends FrontendModelBase {
        /**
         * @overload
         * @param {(event: {id: CompositePrimaryKeyValue}) => void} callback
         * @param {import("${projectRoot}/build/src/frontend-models/base.js").FrontendModelEventOptions} [options]
         * @returns {Promise<() => void>}
         */
        /**
         * @template {import("${projectRoot}/build/src/frontend-models/base.js").FrontendModelClass} T
         * @overload
         * @this {T}
         * @param {(event: {id: import("${projectRoot}/build/src/frontend-models/base.js").FrontendModelEventPrimaryKeyValueFor<InstanceType<T>>}) => void} callback
         * @param {import("${projectRoot}/build/src/frontend-models/base.js").FrontendModelEventOptions} [options]
         * @returns {Promise<() => void>}
         */
        /**
         * @param {(event: {id: never}) => void} callback
         * @param {import("${projectRoot}/build/src/frontend-models/base.js").FrontendModelEventOptions} [options]
         */
        static async onDestroy(callback, options = {}) {
          return await this._registerDestroyEventCallback(callback, options)
        }
      }

      /** @param {import("${projectRoot}/build/src/frontend-models/use-model-class-event.js").FrontendModelCreateUpdateEventPayload} payload */
      function lifecycleHookEventId(payload) {
        /** @type {string | import("${projectRoot}/build/src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue} */
        const id = payload.id

        return id
      }

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

      /**
       * @param {import("${projectRoot}/build/src/frontend-models/base.js").FrontendModelScalarEventClass} ModelClass
       * @param {(event: {id: string}) => void} callback
       */
      function subscribeToScalarDestroy(ModelClass, callback) {
        return ModelClass.onDestroy(callback)
      }

      subscribeToScalarDestroy(GeneratedScalarModel, ({id}) => id.toUpperCase())
      // @ts-expect-error Composite lifecycle event identities are not scalar strings.
      subscribeToScalarDestroy(GeneratedCompositeModel, ({id}) => id.toUpperCase())

      /** @param {{onDestroy: (callback: (event: {id: string}) => void) => Promise<() => void>}} ModelClass */
      function acceptStructuralScalarDestroyModelClass(ModelClass) {
        return ModelClass
      }

      // @ts-expect-error Composite lifecycle event identities are not scalar strings.
      acceptStructuralScalarDestroyModelClass(GeneratedCompositeModel)
    `

    await fs.writeFile(sourcePath, sourceText)

    const diagnostics = await typescriptCliDiagnostics([sourcePath])
    const sourceDiagnostics = diagnostics.filter((diagnostic) => diagnostic.file?.fileName === sourcePath)

    expect(sourceDiagnostics.map((diagnostic) => diagnostic.messageText)).toEqual([])
  })
})
