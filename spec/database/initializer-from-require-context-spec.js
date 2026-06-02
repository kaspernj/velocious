// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import DatabaseRecord from "../../src/database/record/index.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import InitializerFromRequireContext from "../../src/database/initializer-from-require-context.js"

/**
 * @param {Record<string, {default: typeof DatabaseRecord}>} models - Models keyed by require-context path.
 * @returns {import("../../src/database/initializer-from-require-context.js").ModelClassRequireContextType} - Require context.
 */
function buildRequireContext(models) {
  const requireContext = /** @type {import("../../src/database/initializer-from-require-context.js").ModelClassRequireContextType} */ ((fileName) => models[fileName])

  requireContext.keys = () => Object.keys(models)
  requireContext.id = "initializer-from-require-context-spec"

  return requireContext
}

/** @returns {Configuration} - Test configuration. */
function buildConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("Database - initializer from require context", {databaseCleaning: {transaction: true}}, () => {
  it("eager-loads record metadata by default", async () => {
    class EagerMetadataRecord extends DatabaseRecord {
      static initializeRecordCalls = 0

      /**
       * @param {object} args - Options object.
       * @param {Configuration} args.configuration - Configuration instance.
       * @returns {Promise<void>} - Resolves when complete.
       */
      static async initializeRecord({configuration}) {
        this.initializeRecordCalls += 1
        this.registerRecordClass({configuration})
        this._initialized = true
      }

      /** @returns {Promise<boolean>} - Whether the model has a translations table. */
      static async hasTranslationsTable() {
        return false
      }
    }

    const configuration = buildConfiguration()
    const initializer = new InitializerFromRequireContext({
      requireContext: buildRequireContext({"./eager-metadata-record.js": {default: EagerMetadataRecord}})
    })

    await initializer.initialize({configuration})

    expect(EagerMetadataRecord.initializeRecordCalls).toEqual(1)
    expect(EagerMetadataRecord.isInitialized()).toEqual(true)
    expect(configuration.getModelClasses().EagerMetadataRecord).toEqual(EagerMetadataRecord)
  })

  it("registers opted-out models without loading record metadata", async () => {
    class LazyMetadataRecord extends DatabaseRecord {
      /** @returns {Promise<void>} - Never resolves because lazy registration must not call this. */
      static async initializeRecord() {
        throw new Error("Lazy metadata record should not initialize during require-context registration")
      }

      /** @returns {Promise<boolean>} - Never resolves because lazy registration must not check translations. */
      static async hasTranslationsTable() {
        throw new Error("Lazy metadata record should not check translations during require-context registration")
      }
    }

    LazyMetadataRecord.setEagerLoadRecordMetadata(false)

    const configuration = buildConfiguration()
    const initializer = new InitializerFromRequireContext({
      requireContext: buildRequireContext({"./lazy-metadata-record.js": {default: LazyMetadataRecord}})
    })

    await initializer.initialize({configuration})

    expect(LazyMetadataRecord.isInitialized()).toEqual(false)
    expect(configuration.getModelClasses().LazyMetadataRecord).toEqual(LazyMetadataRecord)
  })

  it("best-effort initializes opted-out models at startup when their table exists", async () => {
    class PresentLazyMetadataRecord extends DatabaseRecord {
      static initializeRecordCalls = 0

      /** @returns {{getTableByName: () => Promise<object>}} - Connection whose table exists. */
      static connection() {
        return /** @type {any} */ ({getTableByName: async () => ({})})
      }

      /**
       * @param {object} args - Options object.
       * @param {Configuration} args.configuration - Configuration instance.
       * @returns {Promise<void>} - Resolves when complete.
       */
      static async initializeRecord({configuration}) {
        this.initializeRecordCalls += 1
        this.registerRecordClass({configuration})
        this._initialized = true
      }

      /** @returns {Promise<boolean>} - Whether the model has a translations table. */
      static async hasTranslationsTable() {
        return false
      }
    }

    PresentLazyMetadataRecord.setEagerLoadRecordMetadata(false)

    const configuration = buildConfiguration()
    const initializer = new InitializerFromRequireContext({
      requireContext: buildRequireContext({"./present-lazy-metadata-record.js": {default: PresentLazyMetadataRecord}})
    })

    await initializer.initialize({configuration})

    expect(PresentLazyMetadataRecord.initializeRecordCalls).toEqual(1)
    expect(PresentLazyMetadataRecord.isInitialized()).toEqual(true)
  })

  it("clears stale metadata when an opted-out model is re-registered", async () => {
    class ReRegisteredLazyMetadataRecord extends DatabaseRecord {
      /**
       * @param {object} args - Options object.
       * @param {Configuration} args.configuration - Configuration instance.
       * @returns {Promise<void>} - Resolves when complete.
       */
      static async initializeRecord({configuration}) {
        this.registerRecordClass({configuration})
        this._databaseType = "sqlite"
        this._columns = []
        this._columnsAsHash = {}
        this._initialized = true
      }
    }

    ReRegisteredLazyMetadataRecord.setEagerLoadRecordMetadata(false)
    ReRegisteredLazyMetadataRecord._databaseType = "mysql"
    ReRegisteredLazyMetadataRecord._table = /** @type {any} */ ({})
    ReRegisteredLazyMetadataRecord._columns = [/** @type {any} */ ({})]
    ReRegisteredLazyMetadataRecord._columnsAsHash = {id: /** @type {any} */ ({})}
    ReRegisteredLazyMetadataRecord._columnNames = ["id"]
    ReRegisteredLazyMetadataRecord._columnTypeByName = {id: "integer"}
    ReRegisteredLazyMetadataRecord._attributeNameToColumnName = {id: "id"}
    ReRegisteredLazyMetadataRecord._columnNameToAttributeName = {id: "id"}
    ReRegisteredLazyMetadataRecord._initialized = true

    const configuration = buildConfiguration()
    const initializer = new InitializerFromRequireContext({
      requireContext: buildRequireContext({"./re-registered-lazy-metadata-record.js": {default: ReRegisteredLazyMetadataRecord}})
    })

    await initializer.initialize({configuration})

    expect(ReRegisteredLazyMetadataRecord.isInitialized()).toEqual(false)
    expect(() => ReRegisteredLazyMetadataRecord.getDatabaseType()).toThrow("Database type hasn't been set")
    expect(() => ReRegisteredLazyMetadataRecord.getColumns()).toThrow(/used before initialization/)

    await ReRegisteredLazyMetadataRecord.ensureInitialized()

    expect(ReRegisteredLazyMetadataRecord.getDatabaseType()).toEqual("sqlite")
    expect(ReRegisteredLazyMetadataRecord.isInitialized()).toEqual(true)
  })

  it("initializes opted-out models on first use", async () => {
    class FirstUseLazyMetadataRecord extends DatabaseRecord {
      static initializeRecordCalls = 0

      /**
       * @param {object} args - Options object.
       * @param {Configuration} args.configuration - Configuration instance.
       * @returns {Promise<void>} - Resolves when complete.
       */
      static async initializeRecord({configuration}) {
        this.initializeRecordCalls += 1
        this.registerRecordClass({configuration})
        this._initialized = true
      }
    }

    FirstUseLazyMetadataRecord.setEagerLoadRecordMetadata(false)

    const configuration = buildConfiguration()
    const initializer = new InitializerFromRequireContext({
      requireContext: buildRequireContext({"./first-use-lazy-metadata-record.js": {default: FirstUseLazyMetadataRecord}})
    })

    await initializer.initialize({configuration})

    expect(FirstUseLazyMetadataRecord.initializeRecordCalls).toEqual(0)

    await FirstUseLazyMetadataRecord.ensureInitialized()

    expect(FirstUseLazyMetadataRecord.initializeRecordCalls).toEqual(1)
    expect(FirstUseLazyMetadataRecord.isInitialized()).toEqual(true)
  })
})
