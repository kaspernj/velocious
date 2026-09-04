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
})
