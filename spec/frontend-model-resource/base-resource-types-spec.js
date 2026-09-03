// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {typescriptCliDiagnostics} from "../helpers/typescript-cli-helpers.js"

describe("FrontendModelBaseResource types", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("preserves a frontend model class through the resource generic", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..")
    const tmpDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-frontend-resource-model-type-check-"))
    const sourcePath = `${tmpDirectory}/index.js`
    const sourceText = `
      // @ts-check

      /** @import {FrontendModelResourceClassType} from "${projectRoot}/src/configuration-types.js" */

      import FrontendModelBaseResource from "${projectRoot}/src/frontend-model-resource/base-resource.js"
      import FrontendModelBase from "${projectRoot}/src/frontend-models/base.js"

      class LocalUser extends FrontendModelBase {
        static localOnly() { return "local" }

        static resourceConfig() {
          return {modelName: "User"}
        }
      }

      class LocalProject extends FrontendModelBase {}

      /** @extends {FrontendModelBaseResource<typeof LocalUser>} */
      class LocalUserResource extends FrontendModelBaseResource {
        static ModelClass = LocalUser
      }

      LocalUserResource.modelClass().localOnly()

      /** @type {FrontendModelResourceClassType<typeof LocalUser>} */
      const ResourceClass = LocalUserResource
      const resource = new ResourceClass({
        context: {resourceRuntime: "offline"},
        modelName: "User",
        params: {}
      })

      resource.modelClass().localOnly()

      // @ts-expect-error A typed resource must reject a different model class override.
      new ResourceClass({modelClass: LocalProject})
    `

    await fs.writeFile(sourcePath, sourceText)

    const diagnostics = await typescriptCliDiagnostics([sourcePath])
    const sourceDiagnostics = diagnostics.filter((diagnostic) => diagnostic.file?.fileName === sourcePath)

    expect(sourceDiagnostics.map((diagnostic) => diagnostic.messageText)).toEqual([])
  })
})
