// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "../../src/testing/test.js"
import {typescriptCliDiagnostics} from "../helpers/typescript-cli-helpers.js"

describe("BackgroundJobEnqueueAcknowledgementTimeoutError types", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("exposes the frozen attempt history as readonly", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..")
    const tmpDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-enqueue-acknowledgement-timeout-error-type-check-"))
    const sourcePath = `${tmpDirectory}/index.js`
    const sourceText = `
      // @ts-check

      import BackgroundJobEnqueueAcknowledgementTimeoutError from "${projectRoot}/build/src/background-jobs/enqueue-acknowledgement-timeout-error.js"

      const error = new BackgroundJobEnqueueAcknowledgementTimeoutError({
        acknowledgementTimeoutMs: 40,
        attemptHistory: [{
          acknowledgementWaitElapsedMs: 40,
          attemptElapsedMs: 50,
          attemptKind: "initial",
          attemptNumber: 1,
          explicitlyRejected: false,
          generationFenced: true,
          requestSent: true
        }],
        jobName: "TypedTimeoutJob",
        producerProofPresent: false
      })

      // @ts-expect-error Frozen attempt history cannot accept appended attempts.
      error.attemptHistory.push(error.attemptHistory[0])
      // @ts-expect-error Frozen attempt history cannot remove attempts.
      error.attemptHistory.pop()
      // @ts-expect-error Frozen attempt history cannot replace attempts.
      error.attemptHistory[0] = error.attemptHistory[0]
    `

    try {
      await fs.writeFile(sourcePath, sourceText)

      const diagnostics = await typescriptCliDiagnostics([sourcePath])
      const sourceDiagnostics = diagnostics.filter((diagnostic) => diagnostic.file?.fileName === sourcePath)

      expect(sourceDiagnostics.map((diagnostic) => diagnostic.messageText)).toEqual([])
    } finally {
      await fs.rm(tmpDirectory, {force: true, recursive: true})
    }
  })
})
