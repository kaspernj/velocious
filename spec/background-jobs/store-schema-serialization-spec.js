// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

const fakeDb = /** @type {import("../../src/database/drivers/base.js").default} */ ({})

class ObservedSchemaStore extends BackgroundJobsStore {
  /**
   * @param {object} args - Options.
   * @param {() => Promise<void>} args.applySchemaSteps - Observed schema work.
   */
  constructor({applySchemaSteps}) {
    super({configuration: dummyConfiguration, databaseIdentifier: "background-jobs-schema-serialization-spec"})
    this.applySchemaSteps = applySchemaSteps
    this.connectionCheckouts = 0
  }

  /** @param {Function} callback - Database callback. */
  async _withDb(callback) {
    this.connectionCheckouts++

    return await callback(fakeDb)
  }

  /** @returns {Promise<void>} - Resolves when the observed schema work completes. */
  async _applySchemaSteps() {
    await this.applySchemaSteps()
  }
}

describe("Background jobs store schema serialization", () => {
  it("waits for concurrent schema work before checking out another connection", async () => {
    const firstSchemaStarted = Promise.withResolvers()
    const firstSchemaCanFinish = Promise.withResolvers()
    const schemaError = new Error("schema apply failed")
    const firstStore = new ObservedSchemaStore({
      applySchemaSteps: async () => {
        firstSchemaStarted.resolve()
        await firstSchemaCanFinish.promise
        throw schemaError
      }
    })
    const secondStore = new ObservedSchemaStore({applySchemaSteps: async () => {}})
    const firstResult = firstStore.ensureSchema().then(() => null, (error) => error)

    await firstSchemaStarted.promise

    const secondResult = secondStore.ensureSchema()
    const secondCheckoutsWhileQueued = secondStore.connectionCheckouts

    firstSchemaCanFinish.resolve()

    expect(await firstResult).toEqual(schemaError)
    await secondResult

    expect(secondCheckoutsWhileQueued).toEqual(0)
    expect(firstStore.connectionCheckouts).toEqual(1)
    expect(secondStore.connectionCheckouts).toEqual(1)
  })
})
