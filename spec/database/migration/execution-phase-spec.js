// @ts-check

import { describe, expect, it } from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

describe("Database migration execution phases", () => {
  it("defaults to pre-runtime and accepts only the two supported phases", () => {
    class DefaultMigration extends Migration {}
    class PreRuntimeMigration extends Migration {}
    class PostPublicationMigration extends Migration {}

    PreRuntimeMigration.runInPhase("pre-runtime")
    PostPublicationMigration.runInPhase("post-publication")

    expect(DefaultMigration.getExecutionPhase()).toEqual("pre-runtime")
    expect(PreRuntimeMigration.getExecutionPhase()).toEqual("pre-runtime")
    expect(PostPublicationMigration.getExecutionPhase()).toEqual("post-publication")
    expect(() => /** @type {typeof Migration} */ (class extends Migration {}).runInPhase()).toThrow(/Missing migration execution phase/)
    expect(() => /** @type {typeof Migration} */ (class extends Migration {}).runInPhase("during-runtime")).toThrow(/Unknown migration execution phase.*during-runtime.*pre-runtime.*post-publication/)
  })
})
