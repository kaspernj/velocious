// @ts-check
import UUID from "pure-uuid";
import TableData from "../../table-data/index.js";
import TableIndex from "../../table-data/table-index.js";
import { modelPrimaryKeyCacheKey } from "../../../utils/model-primary-key.js";
import sha256Hex from "../../../utils/sha256-hex.js";
import normalizeRecordAttachmentInput from "./normalize-input.js";
/**
 * AttachmentDriverConstructor type.
 * @typedef {import("../../../configuration-types.js").AttachmentDriverConstructor} AttachmentDriverConstructor */
const ATTACHMENTS_TABLE = "velocious_attachments";
const ATTACHMENT_OWNER_INDEX_NAME = "index_velocious_attachments_on_record_type_and_record_id_digest";
const ATTACHMENT_RECORD_ID_DIGEST_LENGTH = 64;
const ATTACHMENT_RECORD_ID_DIGEST_MIGRATION_BATCH_SIZE = 100;
const ATTACHMENT_SCHEMA_LOCK_NAME = "velocious-attachments-schema";
/**
 * Stores by configuration.
 * @type {WeakMap<import("../../../configuration.js").default, Map<string, RecordAttachmentsStore>>} */
const storesByConfiguration = new WeakMap();
/**
 * Runs generate uuid.
 * @returns {string} - Generated UUID v4 value.
 */
function generateUUID() {
    return new UUID(4).format();
}
/**
 * Returns the canonical stored owner identity for a model attachment.
 * @param {import("../index.js").default} model - Attachment owner.
 * @returns {string} - Canonical owner identity.
 */
function attachmentRecordId(model) {
    return modelPrimaryKeyCacheKey(model.getModelClass().primaryKey(), model.id());
}
/**
 * Returns a bounded digest for indexed attachment owner lookups.
 * @param {string} recordId - Canonical attachment owner identity.
 * @returns {string} - SHA-256 digest.
 */
function attachmentRecordIdDigest(recordId) {
    return sha256Hex(recordId);
}
/**
 * Builds collision-safe attachment owner lookup conditions.
 * @param {object} args - Owner lookup values.
 * @param {string} [args.name] - Optional attachment name.
 * @param {string} args.recordId - Canonical owner identity.
 * @param {string} args.recordType - Owner model name.
 * @returns {Record<string, string>} - Indexed digest and canonical identity conditions.
 */
function attachmentOwnerConditions({ name, recordId, recordType }) {
    /** @type {Record<string, string>} */
    const conditions = {
        record_id: recordId,
        record_id_digest: attachmentRecordIdDigest(recordId),
        record_type: recordType
    };
    if (name !== undefined)
        conditions.name = name;
    return conditions;
}
/**
 * Runs store key for model.
 * @param {import("../index.js").default} model - Model instance.
 * @returns {string} - Store key.
 */
function storeKeyForModel(model) {
    const operation = model.databaseOperation();
    if (operation)
        return operation.databaseIdentity();
    return `${model.getModelClass().getDatabaseIdentifier()}`;
}
/**
 * Returns the physical store key for an already-selected model connection.
 * @param {typeof import("../index.js").default} modelClass - Model class.
 * @param {import("../../drivers/base.js").default} connection - Selected physical connection.
 * @returns {string} - Physical store key.
 */
function storeKeyForModelClass(modelClass, connection) {
    const databaseIdentifier = modelClass.getDatabaseIdentifier();
    const reuseKey = modelClass
        ._getConfiguration()
        .getDatabasePool(databaseIdentifier)
        .getConnectionConfigurationReuseKey(connection);
    return `${databaseIdentifier}:${reuseKey}`;
}
/**
 * Returns the shared attachment store for one configured database identity.
 * @param {object} args - Store identity.
 * @param {import("../../../configuration.js").default} args.configuration - Owning configuration.
 * @param {string} args.databaseIdentifier - Logical database identifier.
 * @param {string} args.storeKey - Physical store key.
 * @returns {RecordAttachmentsStore} - Shared store instance.
 */
function recordAttachmentsStore({ configuration, databaseIdentifier, storeKey }) {
    let storesByDatabaseIdentifier = storesByConfiguration.get(configuration);
    if (!storesByDatabaseIdentifier) {
        storesByDatabaseIdentifier = new Map();
        storesByConfiguration.set(configuration, storesByDatabaseIdentifier);
    }
    let store = storesByDatabaseIdentifier.get(storeKey);
    if (store)
        return store;
    store = new RecordAttachmentsStore({ configuration, databaseIdentifier });
    storesByDatabaseIdentifier.set(storeKey, store);
    return store;
}
/**
 * Returns the attachment store used before a model-level transaction starts.
 * @param {typeof import("../index.js").default} modelClass - Model class opening the transaction.
 * @param {import("../../drivers/base.js").default} connection - Selected physical connection.
 * @returns {RecordAttachmentsStore} - Store instance.
 */
export function recordAttachmentsStoreForModelClass(modelClass, connection) {
    const databaseIdentifier = modelClass.getDatabaseIdentifier();
    return recordAttachmentsStore({
        configuration: modelClass._getConfiguration(),
        databaseIdentifier,
        storeKey: storeKeyForModelClass(modelClass, connection)
    });
}
/**
 * Runs the recordAttachmentsStoreForModel helper.
 * @param {import("../index.js").default} model - Model instance.
 * @returns {RecordAttachmentsStore} - Store instance.
 */
export function recordAttachmentsStoreForModel(model) {
    const configuration = model._getConfiguration();
    const databaseIdentifier = model.databaseOperation()?.databaseIdentifier() || model.getModelClass().getDatabaseIdentifier();
    return recordAttachmentsStore({
        configuration,
        databaseIdentifier,
        storeKey: storeKeyForModel(model)
    });
}
/**
 * Attachment persistence store.
 */
export default class RecordAttachmentsStore {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../../../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.databaseIdentifier - Database identifier.
     */
    constructor({ configuration, databaseIdentifier }) {
        this.configuration = configuration;
        this.databaseIdentifier = databaseIdentifier;
        this._readyPromise = null;
        this._schemaUpgradePromise = null;
        /** @type {number | undefined} */
        this._schemaReadyGeneration = undefined;
        this._driverColumnsAvailable = false;
        this._contentBase64Nullable = true;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Map<string, Record<string, ReturnType<typeof JSON.parse>>>} */
        this._attachmentDriversByName = new Map();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Map<AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, Record<string, ReturnType<typeof JSON.parse>>>} */
        this._attachmentDriversByReference = new Map();
    }
    /**
     * Runs ensure ready.
     * @param {import("../index.js").default} [model] - Operation-owning model.
     * @returns {Promise<void>} - Resolves when schema is ready.
     */
    async ensureReady(model) {
        if (this._readyPromise) {
            await this._readyPromise;
            return;
        }
        this._readyPromise = (async () => {
            await this._withDb(async (db) => {
                await this.ensureSchema(db);
            }, model);
        })();
        try {
            await this._readyPromise;
        }
        finally {
            this._readyPromise = null;
        }
    }
    /**
     * Ensures attachment schema through an already-owned connection.
     * @param {import("../../drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when schema is ready.
     */
    async ensureSchema(db) {
        if (await db.tableExists(ATTACHMENTS_TABLE)) {
            await this.ensureAttachmentStoreSchema({ db });
            return;
        }
        const table = new TableData(ATTACHMENTS_TABLE, { ifNotExists: true });
        table.string("id", { null: false, primaryKey: true });
        table.string("record_type", { null: false, index: true });
        table.text("record_id", { null: false });
        table.string("record_id_digest", { maxLength: ATTACHMENT_RECORD_ID_DIGEST_LENGTH, null: false });
        table.string("name", { null: false, index: true });
        table.integer("position", { null: false });
        table.string("filename", { null: false });
        table.string("content_type", { null: true });
        table.bigint("byte_size", { null: false });
        table.string("driver", { null: true });
        table.string("storage_key", { null: true });
        table.text("content_base64", { null: true });
        table.bigint("created_at_ms", { null: false });
        table.bigint("updated_at_ms", { null: false });
        table.addIndex(new TableIndex(["record_type", "record_id_digest"], { name: ATTACHMENT_OWNER_INDEX_NAME }));
        await db.createTable(table);
        this._driverColumnsAvailable = true;
        this._contentBase64Nullable = true;
        this._schemaReadyGeneration = this._schemaCacheGeneration(db);
    }
    /**
     * Runs attach.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {ReturnType<typeof JSON.parse>} args.input - Attachment input.
     * @param {boolean} args.replace - Whether to replace existing attachments.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async attach({ input, model, name, replace }) {
        await this.ensureReady(model);
        const attachmentsConfiguration = this.configuration.getAttachmentsConfiguration?.() || {};
        const allowPathInput = attachmentsConfiguration.allowPathInput === true;
        const allowedPathPrefixes = Array.isArray(attachmentsConfiguration.allowedPathPrefixes)
            ? attachmentsConfiguration.allowedPathPrefixes
            : undefined;
        const normalizedInput = await normalizeRecordAttachmentInput(input, {
            allowPathInput,
            allowedPathPrefixes,
            environmentHandler: this.configuration.getEnvironmentHandler()
        });
        /**
         * Attachment persistence error.
         * This stays opaque so any JavaScript thrown value is preserved exactly.
         * @type {unknown} */
        let persistenceError = null;
        let persistenceFailed = false;
        try {
            const persistenceInput = await this.persistenceInputFor(normalizedInput);
            await this.persistNormalizedAttachment({
                model,
                name,
                normalizedInput: persistenceInput,
                replace
            });
        }
        catch (error) {
            persistenceFailed = true;
            persistenceError = error;
        }
        if (normalizedInput.pathSource) {
            try {
                await normalizedInput.pathSource.close();
            }
            catch (closeError) {
                if (persistenceFailed) {
                    throw new AggregateError([persistenceError, closeError], `Attachment persistence and path-source close both failed for ${model.getModelClass().getModelName()}#${attachmentRecordId(model)} (${name})`, { cause: closeError });
                }
                throw closeError;
            }
        }
        if (persistenceFailed)
            throw persistenceError;
    }
    /**
     * Materializes path content once when a legacy schema requires Base64.
     * @param {import("./normalize-input.js").NormalizedAttachmentInput} normalizedInput - Normalized attachment input.
     * @returns {Promise<import("./normalize-input.js").NormalizedAttachmentInput>} - Input used by the driver and database.
     */
    async persistenceInputFor(normalizedInput) {
        if (this._contentBase64Nullable || !normalizedInput.pathSource)
            return normalizedInput;
        const contentBuffer = await normalizedInput.pathSource.readBuffer();
        return {
            ...normalizedInput,
            contentBase64: contentBuffer.toString("base64"),
            contentBuffer,
            pathSource: null
        };
    }
    /**
     * Persists one normalized attachment while its path source remains open.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {import("./normalize-input.js").NormalizedAttachmentInput} args.normalizedInput - Normalized attachment.
     * @param {boolean} args.replace - Whether to replace existing attachments.
     * @returns {Promise<void>} - Resolves after persistence.
     */
    async persistNormalizedAttachment({ model, name, normalizedInput, replace }) {
        const attachmentDriver = await this.resolveAttachmentDriver({ model, name });
        const attachmentDriverName = this._attachmentDriverNameFor({ model, name });
        const now = Date.now();
        const recordType = model.getModelClass().getModelName();
        const recordId = attachmentRecordId(model);
        const attachmentId = generateUUID();
        /**
         * Written storage key.
         * @type {string | null} */
        let storageKey = null;
        let rowPersisted = false;
        try {
            const writeResult = await attachmentDriver.write({
                attachmentId,
                input: normalizedInput,
                model,
                name
            });
            storageKey = writeResult.storageKey;
            // Current schemas keep content_base64 nullable and avoid duplicating
            // driver-backed content. Legacy path input was materialized once before
            // the driver write so this value describes those exact persisted bytes.
            const databaseContentBase64 = await this.databaseContentBase64For(normalizedInput);
            await this._withDb(async (db) => {
                if (replace) {
                    const existingRows = await db
                        .newQuery()
                        .from(ATTACHMENTS_TABLE)
                        .where(attachmentOwnerConditions({ name, recordId, recordType }))
                        .results();
                    for (const existingRow of existingRows) {
                        await this.deleteAttachmentRowStorage({ model, name, row: existingRow });
                    }
                    await db.delete({
                        conditions: attachmentOwnerConditions({ name, recordId, recordType }),
                        tableName: ATTACHMENTS_TABLE
                    });
                }
                const position = replace ? 0 : await this._nextPosition({ db, name, recordId, recordType });
                /**
                 * Insert data.
                 * @type {Record<string, ReturnType<typeof JSON.parse>>} */
                const insertData = {
                    byte_size: normalizedInput.byteSize,
                    content_base64: databaseContentBase64,
                    content_type: normalizedInput.contentType,
                    created_at_ms: now,
                    filename: normalizedInput.filename,
                    id: attachmentId,
                    name,
                    position,
                    record_id: recordId,
                    record_id_digest: attachmentRecordIdDigest(recordId),
                    record_type: recordType,
                    updated_at_ms: now
                };
                if (this._driverColumnsAvailable) {
                    insertData.driver = attachmentDriverName;
                    insertData.storage_key = storageKey;
                }
                await db.insert({
                    data: insertData,
                    tableName: ATTACHMENTS_TABLE
                });
                rowPersisted = true;
            }, model);
        }
        catch (error) {
            if (!rowPersisted && storageKey && typeof attachmentDriver.delete === "function") {
                try {
                    await attachmentDriver.delete({
                        model,
                        name,
                        row: { id: attachmentId, storage_key: storageKey },
                        storageKey
                    });
                }
                catch (cleanupError) {
                    throw new AggregateError([error, cleanupError], `Attachment write finalization and new-storage cleanup both failed for ${recordType}#${recordId} (${name})`, { cause: cleanupError });
                }
            }
            throw error;
        }
    }
    /**
     * Resolves the database content_base64 value for current and legacy schemas.
     * @param {import("./normalize-input.js").NormalizedAttachmentInput} normalizedInput - Normalized attachment input.
     * @returns {Promise<string | null>} - Nullable or legacy Base64 database value.
     */
    async databaseContentBase64For(normalizedInput) {
        if (this._contentBase64Nullable)
            return null;
        if (normalizedInput.contentBase64 !== null)
            return normalizedInput.contentBase64;
        throw new Error("Legacy attachment schema requires materialized content bytes");
    }
    /**
     * Runs ensure attachment store schema.
     * @param {object} args - Options.
     * @param {import("../../../database/drivers/base.js").default} args.db - DB connection.
     * @returns {Promise<void>} - Resolves when schema columns are ensured.
     */
    async ensureAttachmentStoreSchema({ db }) {
        if (this._schemaReadyGeneration === this._schemaCacheGeneration(db))
            return;
        if (this._schemaUpgradePromise)
            return await this._schemaUpgradePromise;
        this._schemaUpgradePromise = (async () => {
            const acquired = await db.acquireAdvisoryLock(ATTACHMENT_SCHEMA_LOCK_NAME);
            if (!acquired)
                throw new Error(`Failed to acquire attachment schema lock ${ATTACHMENT_SCHEMA_LOCK_NAME}`);
            try {
                if (!await db.tableExists(ATTACHMENTS_TABLE))
                    return;
                await this._ensureAttachmentStoreSchema({ db });
            }
            finally {
                await db.releaseAdvisoryLock(ATTACHMENT_SCHEMA_LOCK_NAME);
            }
        })();
        try {
            await this._schemaUpgradePromise;
            this._schemaReadyGeneration = this._schemaCacheGeneration(db);
        }
        finally {
            this._schemaUpgradePromise = null;
        }
    }
    /**
     * Returns the schema-cache generation for the connection's physical database.
     * @param {import("../../../database/drivers/base.js").default} db - DB connection.
     * @returns {number} - Current schema-cache generation.
     */
    _schemaCacheGeneration(db) {
        const pool = this.configuration.getDatabasePool(this.databaseIdentifier);
        const reuseKey = pool.getConnectionConfigurationReuseKey(db);
        return this.configuration.schemaCacheGenerationForReuseKey(reuseKey);
    }
    /**
     * Ensures attachment columns and indexes after schema-upgrade serialization is acquired.
     * @param {object} args - Options.
     * @param {import("../../../database/drivers/base.js").default} args.db - DB connection.
     * @returns {Promise<void>} - Resolves when schema columns are ensured.
     */
    async _ensureAttachmentStoreSchema({ db }) {
        const table = await db.getTableByNameOrFail(ATTACHMENTS_TABLE);
        const columns = await table.getColumns();
        const hasDriverColumn = columns.some((column) => column.getName() === "driver");
        const hasStorageKeyColumn = columns.some((column) => column.getName() === "storage_key");
        const contentBase64Column = columns.find((column) => column.getName() === "content_base64");
        const recordIdColumn = columns.find((column) => column.getName() === "record_id");
        const recordIdDigestColumn = columns.find((column) => column.getName() === "record_id_digest");
        const alterTable = new TableData(ATTACHMENTS_TABLE);
        let shouldAlter = false;
        if (!recordIdColumn)
            throw new Error(`${ATTACHMENTS_TABLE}.record_id is missing`);
        const recordIdMaxLength = recordIdColumn.getMaxLength();
        if (typeof recordIdMaxLength === "number" && recordIdMaxLength > 0) {
            for (const index of await recordIdColumn.getIndexes()) {
                if (index.isPrimaryKey())
                    continue;
                const indexName = index.getName();
                if (!indexName)
                    throw new Error(`Expected a name for ${ATTACHMENTS_TABLE}.record_id index`);
                for (const sql of await db.removeIndexSQLs({ name: indexName, tableName: ATTACHMENTS_TABLE })) {
                    await db.query(sql);
                }
            }
            db.clearSchemaCache();
            const recordIdAlterTable = new TableData(ATTACHMENTS_TABLE);
            recordIdAlterTable.text("record_id", {
                isNewColumn: false,
                null: db.getType() === "pgsql" ? undefined : false
            });
            for (const sql of await db.alterTableSQLs(recordIdAlterTable)) {
                await db.query(sql);
            }
            db.clearSchemaCache();
        }
        if (!hasDriverColumn) {
            alterTable.string("driver", { null: true });
            shouldAlter = true;
        }
        if (!hasStorageKeyColumn) {
            alterTable.string("storage_key", { null: true });
            shouldAlter = true;
        }
        if (!recordIdDigestColumn) {
            alterTable.string("record_id_digest", { maxLength: ATTACHMENT_RECORD_ID_DIGEST_LENGTH, null: true });
            shouldAlter = true;
        }
        if (shouldAlter) {
            const alterTableSQLs = await db.alterTableSQLs(alterTable);
            for (const sql of alterTableSQLs) {
                await db.query(sql);
            }
            db.clearSchemaCache();
        }
        if (!recordIdDigestColumn || recordIdDigestColumn.getNull()) {
            await this.backfillAttachmentRecordIdDigests(db);
            await this.ensureAttachmentRecordIdDigestNotNull(db);
        }
        await this.ensureAttachmentOwnerIndex(db);
        this._driverColumnsAvailable = true;
        this._contentBase64Nullable = contentBase64Column ? contentBase64Column.getNull() : true;
    }
    /**
     * Backfills bounded attachment owner digests in small batches.
     * @param {import("../../../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when every existing row has a digest.
     */
    async backfillAttachmentRecordIdDigests(db) {
        while (true) {
            const rows = await db
                .newQuery()
                .from(ATTACHMENTS_TABLE)
                .where({ record_id_digest: null })
                .limit(ATTACHMENT_RECORD_ID_DIGEST_MIGRATION_BATCH_SIZE)
                .results();
            for (const row of rows) {
                if (typeof row.id !== "string" || typeof row.record_id !== "string") {
                    throw new Error(`Expected canonical attachment identity strings while backfilling ${ATTACHMENTS_TABLE}`);
                }
                await db.update({
                    conditions: { id: row.id },
                    data: { record_id_digest: attachmentRecordIdDigest(row.record_id) },
                    tableName: ATTACHMENTS_TABLE
                });
            }
            if (rows.length < ATTACHMENT_RECORD_ID_DIGEST_MIGRATION_BATCH_SIZE)
                return;
        }
    }
    /**
     * Makes the backfilled attachment owner digest required.
     * @param {import("../../../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when the digest column is non-nullable.
     */
    async ensureAttachmentRecordIdDigestNotNull(db) {
        db.clearSchemaCache();
        const table = await db.getTableByNameOrFail(ATTACHMENTS_TABLE);
        const recordIdDigestColumn = await table.getColumnByNameOrFail("record_id_digest");
        if (!recordIdDigestColumn.getNull())
            return;
        const alterTable = new TableData(ATTACHMENTS_TABLE);
        alterTable.string("record_id_digest", {
            isNewColumn: false,
            maxLength: ATTACHMENT_RECORD_ID_DIGEST_LENGTH,
            null: false
        });
        for (const sql of await db.alterTableSQLs(alterTable))
            await db.query(sql);
        db.clearSchemaCache();
    }
    /**
     * Ensures attachment owner queries retain a bounded composite index.
     * @param {import("../../../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when the owner index exists.
     */
    async ensureAttachmentOwnerIndex(db) {
        const table = await db.getTableByNameOrFail(ATTACHMENTS_TABLE);
        const indexes = await table.getIndexes();
        const ownerIndex = indexes.find((index) => {
            const columnNames = index.getColumnNames();
            return columnNames.length === 2 && columnNames[0] === "record_type" && columnNames[1] === "record_id_digest";
        });
        if (ownerIndex)
            return;
        for (const sql of await db.createIndexSQLs({
            columns: ["record_type", "record_id_digest"],
            ifNotExists: true,
            name: ATTACHMENT_OWNER_INDEX_NAME,
            tableName: ATTACHMENTS_TABLE
        }))
            await db.query(sql);
        db.clearSchemaCache();
    }
    /**
     * Runs read attachment row.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<Buffer>} - Attachment bytes.
     */
    async readAttachmentRow({ model, name, row }) {
        if (typeof row.content_base64 === "string" && row.content_base64.length > 0) {
            return Buffer.from(row.content_base64, "base64");
        }
        const storageKey = typeof row.storage_key === "string" && row.storage_key.length > 0 ? row.storage_key : null;
        if (!storageKey) {
            throw new Error(`Attachment row ${String(row.id)} is missing storage key`);
        }
        const attachmentDriver = await this.resolveAttachmentDriver({ model, name, row });
        return await attachmentDriver.read({
            model,
            name,
            row,
            storageKey
        });
    }
    /**
     * Runs attachment row url.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<string | null>} - Attachment URL.
     */
    async attachmentRowUrl({ model, name, row }) {
        const attachmentDriver = await this.resolveAttachmentDriver({ model, name, row });
        if (typeof attachmentDriver.url !== "function")
            return null;
        const storageKey = typeof row.storage_key === "string" && row.storage_key.length > 0
            ? row.storage_key
            : (typeof row.id === "string" ? row.id : "");
        if (!storageKey)
            return null;
        return await attachmentDriver.url({
            model,
            name,
            row,
            storageKey
        });
    }
    /**
     * Runs find one.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {string} [args.id] - Optional attachment id.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Attachment row.
     */
    async findOne({ id, model, name }) {
        await this.ensureReady(model);
        return await this._withDb(async (db) => {
            const recordType = model.getModelClass().getModelName();
            const recordId = attachmentRecordId(model);
            let query = db
                .newQuery()
                .from(ATTACHMENTS_TABLE)
                .where(attachmentOwnerConditions({ name, recordId, recordType }))
                .order("position ASC")
                .order("created_at_ms DESC")
                .limit(1);
            if (id) {
                query = query.where({ id });
            }
            const rows = await query.results();
            return rows[0] || null;
        }, model);
    }
    /**
     * Runs find many.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Attachment rows.
     */
    async findMany({ model, name }) {
        await this.ensureReady(model);
        return await this._withDb(async (db) => {
            const recordType = model.getModelClass().getModelName();
            const recordId = attachmentRecordId(model);
            const query = db
                .newQuery()
                .from(ATTACHMENTS_TABLE)
                .where(attachmentOwnerConditions({ name, recordId, recordType }))
                .order("position ASC")
                .order("created_at_ms ASC");
            return await query.results();
        }, model);
    }
    /**
     * Prepares attachment schema before a record transaction can migrate ownership.
     * @param {object} args - Options.
     * @param {import("../../drivers/base.js").default} args.connection - Record-owning database connection.
     * @returns {Promise<void>} - Resolves when existing attachment schema is current.
     */
    async prepareRecordIdentityMigration({ connection }) {
        await this.ensureAttachmentStoreSchema({ db: connection });
    }
    /**
     * Moves every attachment row to a record's new primary-key identity.
     * @param {object} args - Options.
     * @param {import("../../drivers/base.js").default} args.connection - Transaction-owning database connection.
     * @param {import("../index.js").default} args.model - Attachment owner after the key change.
     * @param {import("../../../utils/model-primary-key.js").ModelPrimaryKeyValue} args.nextIdentity - New owner identity.
     * @param {import("../../../utils/model-primary-key.js").ModelPrimaryKeyValue} args.previousIdentity - Persisted owner identity.
     * @returns {Promise<void>} - Resolves after ownership is migrated.
     */
    async migrateRecordIdentity({ connection, model, nextIdentity, previousIdentity }) {
        const primaryKey = model.getModelClass().primaryKey();
        const nextRecordId = modelPrimaryKeyCacheKey(primaryKey, nextIdentity);
        const previousRecordId = modelPrimaryKeyCacheKey(primaryKey, previousIdentity);
        if (nextRecordId === previousRecordId)
            return;
        if (!await connection.tableExists(ATTACHMENTS_TABLE))
            return;
        await connection.update({
            conditions: attachmentOwnerConditions({
                recordId: previousRecordId,
                recordType: model.getModelClass().getModelName()
            }),
            data: {
                record_id: nextRecordId,
                record_id_digest: attachmentRecordIdDigest(nextRecordId)
            },
            tableName: ATTACHMENTS_TABLE
        });
    }
    /**
     * Runs delete attachment row storage.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<void>} - Resolves when row storage has been deleted.
     */
    async deleteAttachmentRowStorage({ model, name, row }) {
        const storageKey = typeof row.storage_key === "string" && row.storage_key.length > 0 ? row.storage_key : null;
        if (!storageKey)
            return;
        const attachmentDriver = await this.resolveAttachmentDriver({ model, name, row });
        if (typeof attachmentDriver.delete !== "function")
            return;
        await attachmentDriver.delete({
            model,
            name,
            row,
            storageKey
        });
    }
    /**
     * Purges every attachment stored under (model, name): deletes each row's
     * backing storage and then removes the attachment rows. Used to clean up an
     * owner record's attachments before/when the owner is destroyed.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @returns {Promise<number>} - Number of attachments purged.
     */
    async purgeAll({ model, name }) {
        await this.ensureReady(model);
        return await this._withDb(async (db) => {
            const recordType = model.getModelClass().getModelName();
            const recordId = attachmentRecordId(model);
            /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
            const rows = await db
                .newQuery()
                .from(ATTACHMENTS_TABLE)
                .where(attachmentOwnerConditions({ name, recordId, recordType }))
                .results();
            // Refuse to purge when any row's driver cannot delete its backing storage:
            // removing the row while the object stays behind would leak storage and
            // discard the metadata needed to retry cleanup. Fail loudly instead.
            for (const row of rows) {
                const attachmentDriver = await this.resolveAttachmentDriver({ model, name, row });
                if (typeof attachmentDriver.delete !== "function") {
                    throw new Error(`Cannot purge attachment ${row.id} for ${recordType}#${recordId} (${name}): its storage driver does not support deletion.`);
                }
            }
            for (const row of rows) {
                await this.deleteAttachmentRowStorage({ model, name, row });
                // Delete only the snapshotted row by id, so an attachment inserted for the
                // same (record, name) after the snapshot is not removed with its storage
                // still present (which would leave it as unreachable storage).
                await db.delete({ conditions: { id: row.id }, tableName: ATTACHMENTS_TABLE });
            }
            return rows.length;
        }, model);
    }
    /**
     * Runs attachment driver by name.
     * @param {string} driverName - Driver name.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Attachment storage driver instance.
     */
    async attachmentDriverByName(driverName) {
        if (this._attachmentDriversByName.has(driverName)) {
            return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (this._attachmentDriversByName.get(driverName));
        }
        const attachmentConfiguration = this.configuration.getAttachmentsConfiguration?.() || {};
        const configuredDriver = attachmentConfiguration.drivers?.[driverName];
        /**
         * Defines attachmentDriver.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        let attachmentDriver;
        if (!configuredDriver) {
            throw new Error(`No configured attachment storage driver named "${driverName}"`);
        }
        else if (configuredDriver.instance && typeof configuredDriver.instance === "object") {
            attachmentDriver = configuredDriver.instance;
        }
        else if (typeof configuredDriver.driverClass === "function") {
            attachmentDriver = new configuredDriver.driverClass({
                configuration: this.configuration,
                name: driverName,
                options: configuredDriver
            });
        }
        else if (typeof configuredDriver.create === "function") {
            attachmentDriver = configuredDriver.create({
                configuration: this.configuration,
                name: driverName,
                options: configuredDriver
            });
        }
        else {
            throw new Error(`Attachment storage driver "${driverName}" must define instance, driverClass, or create`);
        }
        if (!attachmentDriver || typeof attachmentDriver.write !== "function" || typeof attachmentDriver.read !== "function") {
            throw new Error(`Attachment storage driver "${driverName}" must implement write/read`);
        }
        this._attachmentDriversByName.set(driverName, attachmentDriver);
        return attachmentDriver;
    }
    /**
     * Runs attachment driver by reference.
     * @param {object} args - Options.
     * @param {AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>} args.driverReference - Driver class or instance.
     * @param {string} args.attachmentName - Attachment name.
     * @param {typeof import("../index.js").default} args.modelClass - Model class.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Attachment driver instance.
     */
    attachmentDriverByReference({ attachmentName, driverReference, modelClass }) {
        if (this._attachmentDriversByReference.has(driverReference)) {
            return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (this._attachmentDriversByReference.get(driverReference));
        }
        /**
         * Defines attachmentDriver.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        let attachmentDriver;
        if (typeof driverReference === "function") {
            const DriverClass = /** @type {AttachmentDriverConstructor} */ (driverReference);
            attachmentDriver = new DriverClass({
                attachmentName,
                configuration: this.configuration,
                modelClass
            });
        }
        else if (driverReference && typeof driverReference === "object") {
            attachmentDriver = driverReference;
        }
        else {
            throw new Error(`Invalid attachment driver reference for ${modelClass.name}#${attachmentName}`);
        }
        if (typeof attachmentDriver.write !== "function" || typeof attachmentDriver.read !== "function") {
            throw new Error(`Attachment driver for ${modelClass.name}#${attachmentName} must implement write/read`);
        }
        this._attachmentDriversByReference.set(driverReference, attachmentDriver);
        return attachmentDriver;
    }
    /**
     * Runs attachment driver name for.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @returns {string} - Attachment driver name.
     */
    _attachmentDriverNameFor({ model, name }) {
        const attachmentDefinition = model.getModelClass().getAttachmentByName(name);
        const configuredDriver = attachmentDefinition.driver;
        const attachmentsConfiguration = this.configuration.getAttachmentsConfiguration?.() || {};
        const defaultDriver = attachmentsConfiguration.defaultDriver;
        if (typeof configuredDriver === "string" && configuredDriver.length > 0) {
            return configuredDriver;
        }
        if (typeof configuredDriver === "function") {
            return configuredDriver.name || "custom";
        }
        if (configuredDriver && typeof configuredDriver === "object") {
            const constructorName = configuredDriver.constructor?.name;
            if (typeof constructorName === "string" && constructorName.length > 0 && constructorName !== "Object") {
                return constructorName;
            }
            return "custom";
        }
        if (typeof defaultDriver === "string" && defaultDriver.length > 0) {
            return defaultDriver;
        }
        throw new Error(`No attachment driver configured for ${model.getModelClass().name}#${name}`);
    }
    /**
     * Runs resolve attachment driver.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.row] - Attachment row.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Attachment storage driver instance.
     */
    async resolveAttachmentDriver({ model, name, row }) {
        const attachmentDefinition = model.getModelClass().getAttachmentByName(name);
        const configuredDriver = attachmentDefinition.driver;
        if (typeof configuredDriver === "function" || (configuredDriver && typeof configuredDriver === "object")) {
            return this.attachmentDriverByReference({
                attachmentName: name,
                driverReference: configuredDriver,
                modelClass: model.getModelClass()
            });
        }
        const fallbackDriverName = typeof row?.driver === "string" && row.driver.length > 0
            ? row.driver
            : this._attachmentDriverNameFor({ model, name });
        return await this.attachmentDriverByName(fallbackDriverName);
    }
    /**
     * Runs next position.
     * @param {object} args - Options.
     * @param {import("../../../database/drivers/base.js").default} args.db - DB connection.
     * @param {string} args.name - Attachment name.
     * @param {string} args.recordId - Record id.
     * @param {string} args.recordType - Record type.
     * @returns {Promise<number>} - Next position.
     */
    async _nextPosition({ db, name, recordId, recordType }) {
        const query = db
            .newQuery()
            .from(ATTACHMENTS_TABLE)
            .where(attachmentOwnerConditions({ name, recordId, recordType }))
            .order("position DESC")
            .limit(1);
        const rows = await query.results();
        const currentRow = /** @type {{position?: string | number | null} | undefined} */ (rows[0]);
        const current = Number(currentRow?.position);
        if (!Number.isFinite(current))
            return 0;
        return current + 1;
    }
    /**
     * Runs with db.
     * @template T
     * @param {(db: import("../../../database/drivers/base.js").default) => Promise<T>} callback - Callback.
     * @param {import("../index.js").default} [model] - Operation-owning model.
     * @returns {Promise<T>} - Callback result.
     */
    async _withDb(callback, model) {
        if (model && model.databaseOperation())
            return await callback(model.connection());
        const pool = this.configuration.getDatabasePool(this.databaseIdentifier);
        /**
         * Defines result.
         * @type {T | undefined} */
        let result;
        await pool.withConnection({ name: "Record attachment store" }, async (db) => {
            result = await callback(db);
        });
        return /** @type {T} */ (result);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F0dGFjaG1lbnRzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMkJBQTJCLENBQUE7QUFDakQsT0FBTyxVQUFVLE1BQU0saUNBQWlDLENBQUE7QUFDeEQsT0FBTyxFQUFDLHVCQUF1QixFQUFDLE1BQU0scUNBQXFDLENBQUE7QUFDM0UsT0FBTyxTQUFTLE1BQU0sOEJBQThCLENBQUE7QUFDcEQsT0FBTyw4QkFBOEIsTUFBTSxzQkFBc0IsQ0FBQTtBQUVqRTs7a0hBRWtIO0FBQ2xILE1BQU0saUJBQWlCLEdBQUcsdUJBQXVCLENBQUE7QUFDakQsTUFBTSwyQkFBMkIsR0FBRyxpRUFBaUUsQ0FBQTtBQUNyRyxNQUFNLGtDQUFrQyxHQUFHLEVBQUUsQ0FBQTtBQUM3QyxNQUFNLGdEQUFnRCxHQUFHLEdBQUcsQ0FBQTtBQUM1RCxNQUFNLDJCQUEyQixHQUFHLDhCQUE4QixDQUFBO0FBRWxFOzt1R0FFdUc7QUFDdkcsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBRTNDOzs7R0FHRztBQUNILFNBQVMsWUFBWTtJQUNuQixPQUFPLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFBO0FBQzdCLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxLQUFLO0lBQy9CLE9BQU8sdUJBQXVCLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFDLFVBQVUsRUFBRSxFQUFFLEtBQUssQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFBO0FBQ2hGLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyx3QkFBd0IsQ0FBQyxRQUFRO0lBQ3hDLE9BQU8sU0FBUyxDQUFD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LE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDLENBQUE7UUFFNUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDO1lBQUUsT0FBTyxDQUFDLENBQUE7UUFFdkMsT0FBTyxPQUFPLEdBQUcsQ0FBQyxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxLQUFLO1FBQzNCLElBQUksS0FBSyxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsRUFBRTtZQUFFLE9BQU8sTUFBTSxRQUFRLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUE7UUFFakYsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUE7UUFDeEU7O21DQUUyQjtRQUMzQixJQUFJLE1BQU0sQ0FBQTtRQUVWLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBQyxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUN4RSxNQUFNLEdBQUcsTUFBTSxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDN0IsQ0FBQyxDQUFDLENBQUE7UUFFRixPQUFPLGdCQUFnQixDQUFDLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDbEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgVGFibGVJbmRleCBmcm9tIFwiLi4vLi4vdGFibGUtZGF0YS90YWJsZS1pbmRleC5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNhY2hlS2V5fSBmcm9tIFwiLi4vLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IHNoYTI1NkhleCBmcm9tIFwiLi4vLi4vLi4vdXRpbHMvc2hhMjU2LWhleC5qc1wiXG5pbXBvcnQgbm9ybWFsaXplUmVjb3JkQXR0YWNobWVudElucHV0IGZyb20gXCIuL25vcm1hbGl6ZS1pbnB1dC5qc1wiXG5cbi8qKlxuICogQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3J9IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciAqL1xuY29uc3QgQVRUQUNITUVOVFNfVEFCTEUgPSBcInZlbG9jaW91c19hdHRhY2htZW50c1wiXG5jb25zdCBBVFRBQ0hNRU5UX09XTkVSX0lOREVYX05BTUUgPSBcImluZGV4X3ZlbG9jaW91c19hdHRhY2htZW50c19vbl9yZWNvcmRfdHlwZV9hbmRfcmVjb3JkX2lkX2RpZ2VzdFwiXG5jb25zdCBBVFRBQ0hNRU5UX1JFQ09SRF9JRF9ESUdFU1RfTEVOR1RIID0gNjRcbmNvbnN0IEFUVEFDSE1FTlRfUkVDT1JEX0lEX0RJR0VTVF9NSUdSQVRJT05fQkFUQ0hfU0laRSA9IDEwMFxuY29uc3QgQVRUQUNITUVOVF9TQ0hFTUFfTE9DS19OQU1FID0gXCJ2ZWxvY2lvdXMtYXR0YWNobWVudHMtc2NoZW1hXCJcblxuLyoqXG4gKiBTdG9yZXMgYnkgY29uZmlndXJhdGlvbi5cbiAqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4uLy4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgTWFwPHN0cmluZywgUmVjb3JkQXR0YWNobWVudHNTdG9yZT4+fSAqL1xuY29uc3Qgc3RvcmVzQnlDb25maWd1cmF0aW9uID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIFJ1bnMgZ2VuZXJhdGUgdXVpZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gR2VuZXJhdGVkIFVVSUQgdjQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlVVVJRCgpIHtcbiAgcmV0dXJuIG5ldyBVVUlEKDQpLmZvcm1hdCgpXG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgY2Fub25pY2FsIHN0b3JlZCBvd25lciBpZGVudGl0eSBmb3IgYSBtb2RlbCBhdHRhY2htZW50LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEF0dGFjaG1lbnQgb3duZXIuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIENhbm9uaWNhbCBvd25lciBpZGVudGl0eS5cbiAqL1xuZnVuY3Rpb24gYXR0YWNobWVudFJlY29yZElkKG1vZGVsKSB7XG4gIHJldHVybiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShtb2RlbC5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpLCBtb2RlbC5pZCgpKVxufVxuXG4vKipcbiAqIFJldHVybnMgYSBib3VuZGVkIGRpZ2VzdCBmb3IgaW5kZXhlZCBhdHRhY2htZW50IG93bmVyIGxvb2t1cHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVjb3JkSWQgLSBDYW5vbmljYWwgYXR0YWNobWVudCBvd25lciBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBkaWdlc3QuXG4gKi9cbmZ1bmN0aW9uIGF0dGFjaG1lbnRSZWNvcmRJZERpZ2VzdChyZWNvcmRJZCkge1xuICByZXR1cm4gc2hhMjU2SGV4KHJlY29yZElkKVxufVxuXG4vKipcbiAqIEJ1aWxkcyBjb2xsaXNpb24tc2FmZSBhdHRhY2htZW50IG93bmVyIGxvb2t1cCBjb25kaXRpb25zLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPd25lciBsb29rdXAgdmFsdWVzLlxuICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLm5hbWVdIC0gT3B0aW9uYWwgYXR0YWNobWVudCBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVjb3JkSWQgLSBDYW5vbmljYWwgb3duZXIgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWNvcmRUeXBlIC0gT3duZXIgbW9kZWwgbmFtZS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIEluZGV4ZWQgZGlnZXN0IGFuZCBjYW5vbmljYWwgaWRlbnRpdHkgY29uZGl0aW9ucy5cbiAqL1xuZnVuY3Rpb24gYXR0YWNobWVudE93bmVyQ29uZGl0aW9ucyh7bmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgY29uc3QgY29uZGl0aW9ucyA9IHtcbiAgICByZWNvcmRfaWQ6IHJlY29yZElkLFxuICAgIHJlY29yZF9pZF9kaWdlc3Q6IGF0dGFjaG1lbnRSZWNvcmRJZERpZ2VzdChyZWNvcmRJZCksXG4gICAgcmVjb3JkX3R5cGU6IHJlY29yZFR5cGVcbiAgfVxuXG4gIGlmIChuYW1lICE9PSB1bmRlZmluZWQpIGNvbmRpdGlvbnMubmFtZSA9IG5hbWVcblxuICByZXR1cm4gY29uZGl0aW9uc1xufVxuXG4vKipcbiAqIFJ1bnMgc3RvcmUga2V5IGZvciBtb2RlbC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RvcmUga2V5LlxuICovXG5mdW5jdGlvbiBzdG9yZUtleUZvck1vZGVsKG1vZGVsKSB7XG4gIGNvbnN0IG9wZXJhdGlvbiA9IG1vZGVsLmRhdGFiYXNlT3BlcmF0aW9uKClcblxuICBpZiAob3BlcmF0aW9uKSByZXR1cm4gb3BlcmF0aW9uLmRhdGFiYXNlSWRlbnRpdHkoKVxuXG4gIHJldHVybiBgJHttb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCl9YFxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIHBoeXNpY2FsIHN0b3JlIGtleSBmb3IgYW4gYWxyZWFkeS1zZWxlY3RlZCBtb2RlbCBjb25uZWN0aW9uLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFNlbGVjdGVkIHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFBoeXNpY2FsIHN0b3JlIGtleS5cbiAqL1xuZnVuY3Rpb24gc3RvcmVLZXlGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MsIGNvbm5lY3Rpb24pIHtcbiAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICBjb25zdCByZXVzZUtleSA9IG1vZGVsQ2xhc3NcbiAgICAuX2dldENvbmZpZ3VyYXRpb24oKVxuICAgIC5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIC5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24pXG5cbiAgcmV0dXJuIGAke2RhdGFiYXNlSWRlbnRpZmllcn06JHtyZXVzZUtleX1gXG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgc2hhcmVkIGF0dGFjaG1lbnQgc3RvcmUgZm9yIG9uZSBjb25maWd1cmVkIGRhdGFiYXNlIGlkZW50aXR5LlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTdG9yZSBpZGVudGl0eS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBPd25pbmcgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmRhdGFiYXNlSWRlbnRpZmllciAtIExvZ2ljYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN0b3JlS2V5IC0gUGh5c2ljYWwgc3RvcmUga2V5LlxuICogQHJldHVybnMge1JlY29yZEF0dGFjaG1lbnRzU3RvcmV9IC0gU2hhcmVkIHN0b3JlIGluc3RhbmNlLlxuICovXG5mdW5jdGlvbiByZWNvcmRBdHRhY2htZW50c1N0b3JlKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIHN0b3JlS2V5fSkge1xuICBsZXQgc3RvcmVzQnlEYXRhYmFzZUlkZW50aWZpZXIgPSBzdG9yZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgaWYgKCFzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllcikge1xuICAgIHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyID0gbmV3IE1hcCgpXG4gICAgc3RvcmVzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllcilcbiAgfVxuXG4gIGxldCBzdG9yZSA9IHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyLmdldChzdG9yZUtleSlcblxuICBpZiAoc3RvcmUpIHJldHVybiBzdG9yZVxuXG4gIHN0b3JlID0gbmV3IFJlY29yZEF0dGFjaG1lbnRzU3RvcmUoe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcn0pXG4gIHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyLnNldChzdG9yZUtleSwgc3RvcmUpXG5cbiAgcmV0dXJuIHN0b3JlXG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBzdG9yZSB1c2VkIGJlZm9yZSBhIG1vZGVsLWxldmVsIHRyYW5zYWN0aW9uIHN0YXJ0cy5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBvcGVuaW5nIHRoZSB0cmFuc2FjdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBTZWxlY3RlZCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICogQHJldHVybnMge1JlY29yZEF0dGFjaG1lbnRzU3RvcmV9IC0gU3RvcmUgaW5zdGFuY2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzLCBjb25uZWN0aW9uKSB7XG4gIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IG1vZGVsQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcblxuICByZXR1cm4gcmVjb3JkQXR0YWNobWVudHNTdG9yZSh7XG4gICAgY29uZmlndXJhdGlvbjogbW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICBzdG9yZUtleTogc3RvcmVLZXlGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MsIGNvbm5lY3Rpb24pXG4gIH0pXG59XG5cbi8qKlxuICogUnVucyB0aGUgcmVjb3JkQXR0YWNobWVudHNTdG9yZUZvck1vZGVsIGhlbHBlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtSZWNvcmRBdHRhY2htZW50c1N0b3JlfSAtIFN0b3JlIGluc3RhbmNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkQXR0YWNobWVudHNTdG9yZUZvck1vZGVsKG1vZGVsKSB7XG4gIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBtb2RlbC5fZ2V0Q29uZmlndXJhdGlvbigpXG4gIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IG1vZGVsLmRhdGFiYXNlT3BlcmF0aW9uKCk/LmRhdGFiYXNlSWRlbnRpZmllcigpIHx8IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuXG4gIHJldHVybiByZWNvcmRBdHRhY2htZW50c1N0b3JlKHtcbiAgICBjb25maWd1cmF0aW9uLFxuICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICBzdG9yZUtleTogc3RvcmVLZXlGb3JNb2RlbChtb2RlbClcbiAgfSlcbn1cblxuLyoqXG4gKiBBdHRhY2htZW50IHBlcnNpc3RlbmNlIHN0b3JlLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBSZWNvcmRBdHRhY2htZW50c1N0b3JlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmRhdGFiYXNlSWRlbnRpZmllciAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyfSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmRhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB0aGlzLl9zY2hlbWFVcGdyYWRlUHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zY2hlbWFSZWFkeUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICB0aGlzLl9kcml2ZXJDb2x1bW5zQXZhaWxhYmxlID0gZmFsc2VcbiAgICB0aGlzLl9jb250ZW50QmFzZTY0TnVsbGFibGUgPSB0cnVlXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlOYW1lID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtNYXA8QXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlSZWZlcmVuY2UgPSBuZXcgTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSByZWFkeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBbbW9kZWxdIC0gT3BlcmF0aW9uLW93bmluZyBtb2RlbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzY2hlbWEgaXMgcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeShtb2RlbCkge1xuICAgIGlmICh0aGlzLl9yZWFkeVByb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5lbnN1cmVTY2hlbWEoZGIpXG4gICAgICB9LCBtb2RlbClcbiAgICB9KSgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBhdHRhY2htZW50IHNjaGVtYSB0aHJvdWdoIGFuIGFscmVhZHktb3duZWQgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNjaGVtYSBpcyByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVNjaGVtYShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhBVFRBQ0hNRU5UU19UQUJMRSkpIHtcbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlQXR0YWNobWVudFN0b3JlU2NoZW1hKHtkYn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoQVRUQUNITUVOVFNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJpZFwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInJlY29yZF90eXBlXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnRleHQoXCJyZWNvcmRfaWRcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJyZWNvcmRfaWRfZGlnZXN0XCIsIHttYXhMZW5ndGg6IEFUVEFDSE1FTlRfUkVDT1JEX0lEX0RJR0VTVF9MRU5HVEgsIG51bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJuYW1lXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJwb3NpdGlvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImZpbGVuYW1lXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29udGVudF90eXBlXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJieXRlX3NpemVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJkcml2ZXJcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInN0b3JhZ2Vfa2V5XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwiY29udGVudF9iYXNlNjRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJ1cGRhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYWRkSW5kZXgobmV3IFRhYmxlSW5kZXgoW1wicmVjb3JkX3R5cGVcIiwgXCJyZWNvcmRfaWRfZGlnZXN0XCJdLCB7bmFtZTogQVRUQUNITUVOVF9PV05FUl9JTkRFWF9OQU1FfSkpXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICB0aGlzLl9kcml2ZXJDb2x1bW5zQXZhaWxhYmxlID0gdHJ1ZVxuICAgIHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSA9IHRydWVcbiAgICB0aGlzLl9zY2hlbWFSZWFkeUdlbmVyYXRpb24gPSB0aGlzLl9zY2hlbWFDYWNoZUdlbmVyYXRpb24oZGIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2guXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucmVwbGFjZSAtIFdoZXRoZXIgdG8gcmVwbGFjZSBleGlzdGluZyBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGF0dGFjaCh7aW5wdXQsIG1vZGVsLCBuYW1lLCByZXBsYWNlfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkobW9kZWwpXG4gICAgY29uc3QgYXR0YWNobWVudHNDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbj8uKCkgfHwge31cbiAgICBjb25zdCBhbGxvd1BhdGhJbnB1dCA9IGF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbi5hbGxvd1BhdGhJbnB1dCA9PT0gdHJ1ZVxuICAgIGNvbnN0IGFsbG93ZWRQYXRoUHJlZml4ZXMgPSBBcnJheS5pc0FycmF5KGF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbi5hbGxvd2VkUGF0aFByZWZpeGVzKVxuICAgICAgPyBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24uYWxsb3dlZFBhdGhQcmVmaXhlc1xuICAgICAgOiB1bmRlZmluZWRcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRJbnB1dCA9IGF3YWl0IG5vcm1hbGl6ZVJlY29yZEF0dGFjaG1lbnRJbnB1dChpbnB1dCwge1xuICAgICAgYWxsb3dQYXRoSW5wdXQsXG4gICAgICBhbGxvd2VkUGF0aFByZWZpeGVzLFxuICAgICAgZW52aXJvbm1lbnRIYW5kbGVyOiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICB9KVxuICAgIC8qKlxuICAgICAqIEF0dGFjaG1lbnQgcGVyc2lzdGVuY2UgZXJyb3IuXG4gICAgICogVGhpcyBzdGF5cyBvcGFxdWUgc28gYW55IEphdmFTY3JpcHQgdGhyb3duIHZhbHVlIGlzIHByZXNlcnZlZCBleGFjdGx5LlxuICAgICAqIEB0eXBlIHt1bmtub3dufSAqL1xuICAgIGxldCBwZXJzaXN0ZW5jZUVycm9yID0gbnVsbFxuICAgIGxldCBwZXJzaXN0ZW5jZUZhaWxlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcGVyc2lzdGVuY2VJbnB1dCA9IGF3YWl0IHRoaXMucGVyc2lzdGVuY2VJbnB1dEZvcihub3JtYWxpemVkSW5wdXQpXG5cbiAgICAgIGF3YWl0IHRoaXMucGVyc2lzdE5vcm1hbGl6ZWRBdHRhY2htZW50KHtcbiAgICAgICAgbW9kZWwsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIG5vcm1hbGl6ZWRJbnB1dDogcGVyc2lzdGVuY2VJbnB1dCxcbiAgICAgICAgcmVwbGFjZVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcGVyc2lzdGVuY2VGYWlsZWQgPSB0cnVlXG4gICAgICBwZXJzaXN0ZW5jZUVycm9yID0gZXJyb3JcbiAgICB9XG5cbiAgICBpZiAobm9ybWFsaXplZElucHV0LnBhdGhTb3VyY2UpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG5vcm1hbGl6ZWRJbnB1dC5wYXRoU291cmNlLmNsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgaWYgKHBlcnNpc3RlbmNlRmFpbGVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgW3BlcnNpc3RlbmNlRXJyb3IsIGNsb3NlRXJyb3JdLFxuICAgICAgICAgICAgYEF0dGFjaG1lbnQgcGVyc2lzdGVuY2UgYW5kIHBhdGgtc291cmNlIGNsb3NlIGJvdGggZmFpbGVkIGZvciAke21vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKX0jJHthdHRhY2htZW50UmVjb3JkSWQobW9kZWwpfSAoJHtuYW1lfSlgLFxuICAgICAgICAgICAge2NhdXNlOiBjbG9zZUVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IGNsb3NlRXJyb3JcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocGVyc2lzdGVuY2VGYWlsZWQpIHRocm93IHBlcnNpc3RlbmNlRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXRlcmlhbGl6ZXMgcGF0aCBjb250ZW50IG9uY2Ugd2hlbiBhIGxlZ2FjeSBzY2hlbWEgcmVxdWlyZXMgQmFzZTY0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbm9ybWFsaXplLWlucHV0LmpzXCIpLk5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXR9IG5vcm1hbGl6ZWRJbnB1dCAtIE5vcm1hbGl6ZWQgYXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dD59IC0gSW5wdXQgdXNlZCBieSB0aGUgZHJpdmVyIGFuZCBkYXRhYmFzZS5cbiAgICovXG4gIGFzeW5jIHBlcnNpc3RlbmNlSW5wdXRGb3Iobm9ybWFsaXplZElucHV0KSB7XG4gICAgaWYgKHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSB8fCAhbm9ybWFsaXplZElucHV0LnBhdGhTb3VyY2UpIHJldHVybiBub3JtYWxpemVkSW5wdXRcblxuICAgIGNvbnN0IGNvbnRlbnRCdWZmZXIgPSBhd2FpdCBub3JtYWxpemVkSW5wdXQucGF0aFNvdXJjZS5yZWFkQnVmZmVyKClcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5ub3JtYWxpemVkSW5wdXQsXG4gICAgICBjb250ZW50QmFzZTY0OiBjb250ZW50QnVmZmVyLnRvU3RyaW5nKFwiYmFzZTY0XCIpLFxuICAgICAgY29udGVudEJ1ZmZlcixcbiAgICAgIHBhdGhTb3VyY2U6IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgb25lIG5vcm1hbGl6ZWQgYXR0YWNobWVudCB3aGlsZSBpdHMgcGF0aCBzb3VyY2UgcmVtYWlucyBvcGVuLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbm9ybWFsaXplLWlucHV0LmpzXCIpLk5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXR9IGFyZ3Mubm9ybWFsaXplZElucHV0IC0gTm9ybWFsaXplZCBhdHRhY2htZW50LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucmVwbGFjZSAtIFdoZXRoZXIgdG8gcmVwbGFjZSBleGlzdGluZyBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBwZXJzaXN0Tm9ybWFsaXplZEF0dGFjaG1lbnQoe21vZGVsLCBuYW1lLCBub3JtYWxpemVkSW5wdXQsIHJlcGxhY2V9KSB7XG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lfSlcbiAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyTmFtZSA9IHRoaXMuX2F0dGFjaG1lbnREcml2ZXJOYW1lRm9yKHttb2RlbCwgbmFtZX0pXG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IHJlY29yZFR5cGUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICBjb25zdCByZWNvcmRJZCA9IGF0dGFjaG1lbnRSZWNvcmRJZChtb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50SWQgPSBnZW5lcmF0ZVVVSUQoKVxuICAgIC8qKlxuICAgICAqIFdyaXR0ZW4gc3RvcmFnZSBrZXkuXG4gICAgICogQHR5cGUge3N0cmluZyB8IG51bGx9ICovXG4gICAgbGV0IHN0b3JhZ2VLZXkgPSBudWxsXG4gICAgbGV0IHJvd1BlcnNpc3RlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgd3JpdGVSZXN1bHQgPSBhd2FpdCBhdHRhY2htZW50RHJpdmVyLndyaXRlKHtcbiAgICAgICAgYXR0YWNobWVudElkLFxuICAgICAgICBpbnB1dDogbm9ybWFsaXplZElucHV0LFxuICAgICAgICBtb2RlbCxcbiAgICAgICAgbmFtZVxuICAgICAgfSlcblxuICAgICAgc3RvcmFnZUtleSA9IHdyaXRlUmVzdWx0LnN0b3JhZ2VLZXlcblxuICAgICAgLy8gQ3VycmVudCBzY2hlbWFzIGtlZXAgY29udGVudF9iYXNlNjQgbnVsbGFibGUgYW5kIGF2b2lkIGR1cGxpY2F0aW5nXG4gICAgICAvLyBkcml2ZXItYmFja2VkIGNvbnRlbnQuIExlZ2FjeSBwYXRoIGlucHV0IHdhcyBtYXRlcmlhbGl6ZWQgb25jZSBiZWZvcmVcbiAgICAgIC8vIHRoZSBkcml2ZXIgd3JpdGUgc28gdGhpcyB2YWx1ZSBkZXNjcmliZXMgdGhvc2UgZXhhY3QgcGVyc2lzdGVkIGJ5dGVzLlxuICAgICAgY29uc3QgZGF0YWJhc2VDb250ZW50QmFzZTY0ID0gYXdhaXQgdGhpcy5kYXRhYmFzZUNvbnRlbnRCYXNlNjRGb3Iobm9ybWFsaXplZElucHV0KVxuXG4gICAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGlmIChyZXBsYWNlKSB7XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmdSb3dzID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgICAgICAgIC53aGVyZShhdHRhY2htZW50T3duZXJDb25kaXRpb25zKHtuYW1lLCByZWNvcmRJZCwgcmVjb3JkVHlwZX0pKVxuICAgICAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAgICAgZm9yIChjb25zdCBleGlzdGluZ1JvdyBvZiBleGlzdGluZ1Jvd3MpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZGVsZXRlQXR0YWNobWVudFJvd1N0b3JhZ2Uoe21vZGVsLCBuYW1lLCByb3c6IGV4aXN0aW5nUm93fSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgICAgICAgY29uZGl0aW9uczogYXR0YWNobWVudE93bmVyQ29uZGl0aW9ucyh7bmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KSxcbiAgICAgICAgICAgIHRhYmxlTmFtZTogQVRUQUNITUVOVFNfVEFCTEVcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcG9zaXRpb24gPSByZXBsYWNlID8gMCA6IGF3YWl0IHRoaXMuX25leHRQb3NpdGlvbih7ZGIsIG5hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSlcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEluc2VydCBkYXRhLlxuICAgICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgICBjb25zdCBpbnNlcnREYXRhID0ge1xuICAgICAgICAgIGJ5dGVfc2l6ZTogbm9ybWFsaXplZElucHV0LmJ5dGVTaXplLFxuICAgICAgICAgIGNvbnRlbnRfYmFzZTY0OiBkYXRhYmFzZUNvbnRlbnRCYXNlNjQsXG4gICAgICAgICAgY29udGVudF90eXBlOiBub3JtYWxpemVkSW5wdXQuY29udGVudFR5cGUsXG4gICAgICAgICAgY3JlYXRlZF9hdF9tczogbm93LFxuICAgICAgICAgIGZpbGVuYW1lOiBub3JtYWxpemVkSW5wdXQuZmlsZW5hbWUsXG4gICAgICAgICAgaWQ6IGF0dGFjaG1lbnRJZCxcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIHBvc2l0aW9uLFxuICAgICAgICAgIHJlY29yZF9pZDogcmVjb3JkSWQsXG4gICAgICAgICAgcmVjb3JkX2lkX2RpZ2VzdDogYXR0YWNobWVudFJlY29yZElkRGlnZXN0KHJlY29yZElkKSxcbiAgICAgICAgICByZWNvcmRfdHlwZTogcmVjb3JkVHlwZSxcbiAgICAgICAgICB1cGRhdGVkX2F0X21zOiBub3dcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLl9kcml2ZXJDb2x1bW5zQXZhaWxhYmxlKSB7XG4gICAgICAgICAgaW5zZXJ0RGF0YS5kcml2ZXIgPSBhdHRhY2htZW50RHJpdmVyTmFtZVxuICAgICAgICAgIGluc2VydERhdGEuc3RvcmFnZV9rZXkgPSBzdG9yYWdlS2V5XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgICAgIGRhdGE6IGluc2VydERhdGEsXG4gICAgICAgICAgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRVxuICAgICAgICB9KVxuXG4gICAgICAgIHJvd1BlcnNpc3RlZCA9IHRydWVcbiAgICAgIH0sIG1vZGVsKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIXJvd1BlcnNpc3RlZCAmJiBzdG9yYWdlS2V5ICYmIHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLmRlbGV0ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgYXR0YWNobWVudERyaXZlci5kZWxldGUoe1xuICAgICAgICAgICAgbW9kZWwsXG4gICAgICAgICAgICBuYW1lLFxuICAgICAgICAgICAgcm93OiB7aWQ6IGF0dGFjaG1lbnRJZCwgc3RvcmFnZV9rZXk6IHN0b3JhZ2VLZXl9LFxuICAgICAgICAgICAgc3RvcmFnZUtleVxuICAgICAgICAgIH0pXG4gICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xuICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtlcnJvciwgY2xlYW51cEVycm9yXSxcbiAgICAgICAgICAgIGBBdHRhY2htZW50IHdyaXRlIGZpbmFsaXphdGlvbiBhbmQgbmV3LXN0b3JhZ2UgY2xlYW51cCBib3RoIGZhaWxlZCBmb3IgJHtyZWNvcmRUeXBlfSMke3JlY29yZElkfSAoJHtuYW1lfSlgLFxuICAgICAgICAgICAge2NhdXNlOiBjbGVhbnVwRXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBkYXRhYmFzZSBjb250ZW50X2Jhc2U2NCB2YWx1ZSBmb3IgY3VycmVudCBhbmQgbGVnYWN5IHNjaGVtYXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dH0gbm9ybWFsaXplZElucHV0IC0gTm9ybWFsaXplZCBhdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBOdWxsYWJsZSBvciBsZWdhY3kgQmFzZTY0IGRhdGFiYXNlIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgZGF0YWJhc2VDb250ZW50QmFzZTY0Rm9yKG5vcm1hbGl6ZWRJbnB1dCkge1xuICAgIGlmICh0aGlzLl9jb250ZW50QmFzZTY0TnVsbGFibGUpIHJldHVybiBudWxsXG4gICAgaWYgKG5vcm1hbGl6ZWRJbnB1dC5jb250ZW50QmFzZTY0ICE9PSBudWxsKSByZXR1cm4gbm9ybWFsaXplZElucHV0LmNvbnRlbnRCYXNlNjRcblxuICAgIHRocm93IG5ldyBFcnJvcihcIkxlZ2FjeSBhdHRhY2htZW50IHNjaGVtYSByZXF1aXJlcyBtYXRlcmlhbGl6ZWQgY29udGVudCBieXRlc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGF0dGFjaG1lbnQgc3RvcmUgc2NoZW1hLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEQiBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNjaGVtYSBjb2x1bW5zIGFyZSBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQXR0YWNobWVudFN0b3JlU2NoZW1hKHtkYn0pIHtcbiAgICBpZiAodGhpcy5fc2NoZW1hUmVhZHlHZW5lcmF0aW9uID09PSB0aGlzLl9zY2hlbWFDYWNoZUdlbmVyYXRpb24oZGIpKSByZXR1cm5cbiAgICBpZiAodGhpcy5fc2NoZW1hVXBncmFkZVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLl9zY2hlbWFVcGdyYWRlUHJvbWlzZVxuXG4gICAgdGhpcy5fc2NoZW1hVXBncmFkZVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKEFUVEFDSE1FTlRfU0NIRU1BX0xPQ0tfTkFNRSlcblxuICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gYWNxdWlyZSBhdHRhY2htZW50IHNjaGVtYSBsb2NrICR7QVRUQUNITUVOVF9TQ0hFTUFfTE9DS19OQU1FfWApXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghYXdhaXQgZGIudGFibGVFeGlzdHMoQVRUQUNITUVOVFNfVEFCTEUpKSByZXR1cm5cblxuICAgICAgICBhd2FpdCB0aGlzLl9lbnN1cmVBdHRhY2htZW50U3RvcmVTY2hlbWEoe2RifSlcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2soQVRUQUNITUVOVF9TQ0hFTUFfTE9DS19OQU1FKVxuICAgICAgfVxuICAgIH0pKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9zY2hlbWFVcGdyYWRlUHJvbWlzZVxuICAgICAgdGhpcy5fc2NoZW1hUmVhZHlHZW5lcmF0aW9uID0gdGhpcy5fc2NoZW1hQ2FjaGVHZW5lcmF0aW9uKGRiKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9zY2hlbWFVcGdyYWRlUHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc2NoZW1hLWNhY2hlIGdlbmVyYXRpb24gZm9yIHRoZSBjb25uZWN0aW9uJ3MgcGh5c2ljYWwgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gREIgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBDdXJyZW50IHNjaGVtYS1jYWNoZSBnZW5lcmF0aW9uLlxuICAgKi9cbiAgX3NjaGVtYUNhY2hlR2VuZXJhdGlvbihkYikge1xuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIGNvbnN0IHJldXNlS2V5ID0gcG9vbC5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGRiKVxuXG4gICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvbi5zY2hlbWFDYWNoZUdlbmVyYXRpb25Gb3JSZXVzZUtleShyZXVzZUtleSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGF0dGFjaG1lbnQgY29sdW1ucyBhbmQgaW5kZXhlcyBhZnRlciBzY2hlbWEtdXBncmFkZSBzZXJpYWxpemF0aW9uIGlzIGFjcXVpcmVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEQiBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNjaGVtYSBjb2x1bW5zIGFyZSBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUF0dGFjaG1lbnRTdG9yZVNjaGVtYSh7ZGJ9KSB7XG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICBjb25zdCBjb2x1bW5zID0gYXdhaXQgdGFibGUuZ2V0Q29sdW1ucygpXG4gICAgY29uc3QgaGFzRHJpdmVyQ29sdW1uID0gY29sdW1ucy5zb21lKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT09IFwiZHJpdmVyXCIpXG4gICAgY29uc3QgaGFzU3RvcmFnZUtleUNvbHVtbiA9IGNvbHVtbnMuc29tZSgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09PSBcInN0b3JhZ2Vfa2V5XCIpXG4gICAgY29uc3QgY29udGVudEJhc2U2NENvbHVtbiA9IGNvbHVtbnMuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09PSBcImNvbnRlbnRfYmFzZTY0XCIpXG4gICAgY29uc3QgcmVjb3JkSWRDb2x1bW4gPSBjb2x1bW5zLmZpbmQoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSA9PT0gXCJyZWNvcmRfaWRcIilcbiAgICBjb25zdCByZWNvcmRJZERpZ2VzdENvbHVtbiA9IGNvbHVtbnMuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09PSBcInJlY29yZF9pZF9kaWdlc3RcIilcbiAgICBjb25zdCBhbHRlclRhYmxlID0gbmV3IFRhYmxlRGF0YShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICBsZXQgc2hvdWxkQWx0ZXIgPSBmYWxzZVxuXG4gICAgaWYgKCFyZWNvcmRJZENvbHVtbikgdGhyb3cgbmV3IEVycm9yKGAke0FUVEFDSE1FTlRTX1RBQkxFfS5yZWNvcmRfaWQgaXMgbWlzc2luZ2ApXG5cbiAgICBjb25zdCByZWNvcmRJZE1heExlbmd0aCA9IHJlY29yZElkQ29sdW1uLmdldE1heExlbmd0aCgpXG5cbiAgICBpZiAodHlwZW9mIHJlY29yZElkTWF4TGVuZ3RoID09PSBcIm51bWJlclwiICYmIHJlY29yZElkTWF4TGVuZ3RoID4gMCkge1xuICAgICAgZm9yIChjb25zdCBpbmRleCBvZiBhd2FpdCByZWNvcmRJZENvbHVtbi5nZXRJbmRleGVzKCkpIHtcbiAgICAgICAgaWYgKGluZGV4LmlzUHJpbWFyeUtleSgpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IGluZGV4TmFtZSA9IGluZGV4LmdldE5hbWUoKVxuXG4gICAgICAgIGlmICghaW5kZXhOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGEgbmFtZSBmb3IgJHtBVFRBQ0hNRU5UU19UQUJMRX0ucmVjb3JkX2lkIGluZGV4YClcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5yZW1vdmVJbmRleFNRTHMoe25hbWU6IGluZGV4TmFtZSwgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRX0pKSB7XG4gICAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgcmVjb3JkSWRBbHRlclRhYmxlID0gbmV3IFRhYmxlRGF0YShBVFRBQ0hNRU5UU19UQUJMRSlcblxuICAgICAgcmVjb3JkSWRBbHRlclRhYmxlLnRleHQoXCJyZWNvcmRfaWRcIiwge1xuICAgICAgICBpc05ld0NvbHVtbjogZmFsc2UsXG4gICAgICAgIG51bGw6IGRiLmdldFR5cGUoKSA9PT0gXCJwZ3NxbFwiID8gdW5kZWZpbmVkIDogZmFsc2VcbiAgICAgIH0pXG5cbiAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHJlY29yZElkQWx0ZXJUYWJsZSkpIHtcbiAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9XG5cbiAgICBpZiAoIWhhc0RyaXZlckNvbHVtbikge1xuICAgICAgYWx0ZXJUYWJsZS5zdHJpbmcoXCJkcml2ZXJcIiwge251bGw6IHRydWV9KVxuICAgICAgc2hvdWxkQWx0ZXIgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCFoYXNTdG9yYWdlS2V5Q29sdW1uKSB7XG4gICAgICBhbHRlclRhYmxlLnN0cmluZyhcInN0b3JhZ2Vfa2V5XCIsIHtudWxsOiB0cnVlfSlcbiAgICAgIHNob3VsZEFsdGVyID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmICghcmVjb3JkSWREaWdlc3RDb2x1bW4pIHtcbiAgICAgIGFsdGVyVGFibGUuc3RyaW5nKFwicmVjb3JkX2lkX2RpZ2VzdFwiLCB7bWF4TGVuZ3RoOiBBVFRBQ0hNRU5UX1JFQ09SRF9JRF9ESUdFU1RfTEVOR1RILCBudWxsOiB0cnVlfSlcbiAgICAgIHNob3VsZEFsdGVyID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChzaG91bGRBbHRlcikge1xuICAgICAgY29uc3QgYWx0ZXJUYWJsZVNRTHMgPSBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyhhbHRlclRhYmxlKVxuXG4gICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhbHRlclRhYmxlU1FMcykge1xuICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH1cblxuICAgIGlmICghcmVjb3JkSWREaWdlc3RDb2x1bW4gfHwgcmVjb3JkSWREaWdlc3RDb2x1bW4uZ2V0TnVsbCgpKSB7XG4gICAgICBhd2FpdCB0aGlzLmJhY2tmaWxsQXR0YWNobWVudFJlY29yZElkRGlnZXN0cyhkYilcbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlQXR0YWNobWVudFJlY29yZElkRGlnZXN0Tm90TnVsbChkYilcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZUF0dGFjaG1lbnRPd25lckluZGV4KGRiKVxuXG4gICAgdGhpcy5fZHJpdmVyQ29sdW1uc0F2YWlsYWJsZSA9IHRydWVcbiAgICB0aGlzLl9jb250ZW50QmFzZTY0TnVsbGFibGUgPSBjb250ZW50QmFzZTY0Q29sdW1uID8gY29udGVudEJhc2U2NENvbHVtbi5nZXROdWxsKCkgOiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogQmFja2ZpbGxzIGJvdW5kZWQgYXR0YWNobWVudCBvd25lciBkaWdlc3RzIGluIHNtYWxsIGJhdGNoZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSBleGlzdGluZyByb3cgaGFzIGEgZGlnZXN0LlxuICAgKi9cbiAgYXN5bmMgYmFja2ZpbGxBdHRhY2htZW50UmVjb3JkSWREaWdlc3RzKGRiKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtyZWNvcmRfaWRfZGlnZXN0OiBudWxsfSlcbiAgICAgICAgLmxpbWl0KEFUVEFDSE1FTlRfUkVDT1JEX0lEX0RJR0VTVF9NSUdSQVRJT05fQkFUQ0hfU0laRSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygcm93LmlkICE9PSBcInN0cmluZ1wiIHx8IHR5cGVvZiByb3cucmVjb3JkX2lkICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBjYW5vbmljYWwgYXR0YWNobWVudCBpZGVudGl0eSBzdHJpbmdzIHdoaWxlIGJhY2tmaWxsaW5nICR7QVRUQUNITUVOVFNfVEFCTEV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiByb3cuaWR9LFxuICAgICAgICAgIGRhdGE6IHtyZWNvcmRfaWRfZGlnZXN0OiBhdHRhY2htZW50UmVjb3JkSWREaWdlc3Qocm93LnJlY29yZF9pZCl9LFxuICAgICAgICAgIHRhYmxlTmFtZTogQVRUQUNITUVOVFNfVEFCTEVcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgaWYgKHJvd3MubGVuZ3RoIDwgQVRUQUNITUVOVF9SRUNPUkRfSURfRElHRVNUX01JR1JBVElPTl9CQVRDSF9TSVpFKSByZXR1cm5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWFrZXMgdGhlIGJhY2tmaWxsZWQgYXR0YWNobWVudCBvd25lciBkaWdlc3QgcmVxdWlyZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgZGlnZXN0IGNvbHVtbiBpcyBub24tbnVsbGFibGUuXG4gICAqL1xuICBhc3luYyBlbnN1cmVBdHRhY2htZW50UmVjb3JkSWREaWdlc3ROb3ROdWxsKGRiKSB7XG4gICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICBjb25zdCByZWNvcmRJZERpZ2VzdENvbHVtbiA9IGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZU9yRmFpbChcInJlY29yZF9pZF9kaWdlc3RcIilcblxuICAgIGlmICghcmVjb3JkSWREaWdlc3RDb2x1bW4uZ2V0TnVsbCgpKSByZXR1cm5cblxuICAgIGNvbnN0IGFsdGVyVGFibGUgPSBuZXcgVGFibGVEYXRhKEFUVEFDSE1FTlRTX1RBQkxFKVxuXG4gICAgYWx0ZXJUYWJsZS5zdHJpbmcoXCJyZWNvcmRfaWRfZGlnZXN0XCIsIHtcbiAgICAgIGlzTmV3Q29sdW1uOiBmYWxzZSxcbiAgICAgIG1heExlbmd0aDogQVRUQUNITUVOVF9SRUNPUkRfSURfRElHRVNUX0xFTkdUSCxcbiAgICAgIG51bGw6IGZhbHNlXG4gICAgfSlcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKGFsdGVyVGFibGUpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGF0dGFjaG1lbnQgb3duZXIgcXVlcmllcyByZXRhaW4gYSBib3VuZGVkIGNvbXBvc2l0ZSBpbmRleC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBvd25lciBpbmRleCBleGlzdHMuXG4gICAqL1xuICBhc3luYyBlbnN1cmVBdHRhY2htZW50T3duZXJJbmRleChkYikge1xuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoQVRUQUNITUVOVFNfVEFCTEUpXG4gICAgY29uc3QgaW5kZXhlcyA9IGF3YWl0IHRhYmxlLmdldEluZGV4ZXMoKVxuICAgIGNvbnN0IG93bmVySW5kZXggPSBpbmRleGVzLmZpbmQoKGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBjb2x1bW5OYW1lcyA9IGluZGV4LmdldENvbHVtbk5hbWVzKClcblxuICAgICAgcmV0dXJuIGNvbHVtbk5hbWVzLmxlbmd0aCA9PT0gMiAmJiBjb2x1bW5OYW1lc1swXSA9PT0gXCJyZWNvcmRfdHlwZVwiICYmIGNvbHVtbk5hbWVzWzFdID09PSBcInJlY29yZF9pZF9kaWdlc3RcIlxuICAgIH0pXG5cbiAgICBpZiAob3duZXJJbmRleCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5jcmVhdGVJbmRleFNRTHMoe1xuICAgICAgY29sdW1uczogW1wicmVjb3JkX3R5cGVcIiwgXCJyZWNvcmRfaWRfZGlnZXN0XCJdLFxuICAgICAgaWZOb3RFeGlzdHM6IHRydWUsXG4gICAgICBuYW1lOiBBVFRBQ0hNRU5UX09XTkVSX0lOREVYX05BTUUsXG4gICAgICB0YWJsZU5hbWU6IEFUVEFDSE1FTlRTX1RBQkxFXG4gICAgfSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZCBhdHRhY2htZW50IHJvdy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mucm93IC0gQXR0YWNobWVudCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJ1ZmZlcj59IC0gQXR0YWNobWVudCBieXRlcy5cbiAgICovXG4gIGFzeW5jIHJlYWRBdHRhY2htZW50Um93KHttb2RlbCwgbmFtZSwgcm93fSkge1xuICAgIGlmICh0eXBlb2Ygcm93LmNvbnRlbnRfYmFzZTY0ID09PSBcInN0cmluZ1wiICYmIHJvdy5jb250ZW50X2Jhc2U2NC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gQnVmZmVyLmZyb20ocm93LmNvbnRlbnRfYmFzZTY0LCBcImJhc2U2NFwiKVxuICAgIH1cblxuICAgIGNvbnN0IHN0b3JhZ2VLZXkgPSB0eXBlb2Ygcm93LnN0b3JhZ2Vfa2V5ID09PSBcInN0cmluZ1wiICYmIHJvdy5zdG9yYWdlX2tleS5sZW5ndGggPiAwID8gcm93LnN0b3JhZ2Vfa2V5IDogbnVsbFxuXG4gICAgaWYgKCFzdG9yYWdlS2V5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgcm93ICR7U3RyaW5nKHJvdy5pZCl9IGlzIG1pc3Npbmcgc3RvcmFnZSBrZXlgKVxuICAgIH1cblxuICAgIGNvbnN0IGF0dGFjaG1lbnREcml2ZXIgPSBhd2FpdCB0aGlzLnJlc29sdmVBdHRhY2htZW50RHJpdmVyKHttb2RlbCwgbmFtZSwgcm93fSlcblxuICAgIHJldHVybiBhd2FpdCBhdHRhY2htZW50RHJpdmVyLnJlYWQoe1xuICAgICAgbW9kZWwsXG4gICAgICBuYW1lLFxuICAgICAgcm93LFxuICAgICAgc3RvcmFnZUtleVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IHJvdyB1cmwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJvdyAtIEF0dGFjaG1lbnQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBBdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGFzeW5jIGF0dGFjaG1lbnRSb3dVcmwoe21vZGVsLCBuYW1lLCByb3d9KSB7XG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lLCByb3d9KVxuXG4gICAgaWYgKHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLnVybCAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc3RvcmFnZUtleSA9IHR5cGVvZiByb3cuc3RvcmFnZV9rZXkgPT09IFwic3RyaW5nXCIgJiYgcm93LnN0b3JhZ2Vfa2V5Lmxlbmd0aCA+IDBcbiAgICAgID8gcm93LnN0b3JhZ2Vfa2V5XG4gICAgICA6ICh0eXBlb2Ygcm93LmlkID09PSBcInN0cmluZ1wiID8gcm93LmlkIDogXCJcIilcblxuICAgIGlmICghc3RvcmFnZUtleSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBhd2FpdCBhdHRhY2htZW50RHJpdmVyLnVybCh7XG4gICAgICBtb2RlbCxcbiAgICAgIG5hbWUsXG4gICAgICByb3csXG4gICAgICBzdG9yYWdlS2V5XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb25lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaWRdIC0gT3B0aW9uYWwgYXR0YWNobWVudCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gQXR0YWNobWVudCByb3cuXG4gICAqL1xuICBhc3luYyBmaW5kT25lKHtpZCwgbW9kZWwsIG5hbWV9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeShtb2RlbClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmRUeXBlID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG4gICAgICBjb25zdCByZWNvcmRJZCA9IGF0dGFjaG1lbnRSZWNvcmRJZChtb2RlbClcbiAgICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoYXR0YWNobWVudE93bmVyQ29uZGl0aW9ucyh7bmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KSlcbiAgICAgICAgLm9yZGVyKFwicG9zaXRpb24gQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgREVTQ1wiKVxuICAgICAgICAubGltaXQoMSlcblxuICAgICAgaWYgKGlkKSB7XG4gICAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2lkfSlcbiAgICAgIH1cblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93c1swXSB8fCBudWxsXG4gICAgfSwgbW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG1hbnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSAtIEF0dGFjaG1lbnQgcm93cy5cbiAgICovXG4gIGFzeW5jIGZpbmRNYW55KHttb2RlbCwgbmFtZX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KG1vZGVsKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZFR5cGUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICAgIGNvbnN0IHJlY29yZElkID0gYXR0YWNobWVudFJlY29yZElkKG1vZGVsKVxuICAgICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgICAgLndoZXJlKGF0dGFjaG1lbnRPd25lckNvbmRpdGlvbnMoe25hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSkpXG4gICAgICAgIC5vcmRlcihcInBvc2l0aW9uIEFTQ1wiKVxuICAgICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuXG4gICAgICByZXR1cm4gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgfSwgbW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUHJlcGFyZXMgYXR0YWNobWVudCBzY2hlbWEgYmVmb3JlIGEgcmVjb3JkIHRyYW5zYWN0aW9uIGNhbiBtaWdyYXRlIG93bmVyc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbm5lY3Rpb24gLSBSZWNvcmQtb3duaW5nIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXhpc3RpbmcgYXR0YWNobWVudCBzY2hlbWEgaXMgY3VycmVudC5cbiAgICovXG4gIGFzeW5jIHByZXBhcmVSZWNvcmRJZGVudGl0eU1pZ3JhdGlvbih7Y29ubmVjdGlvbn0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUF0dGFjaG1lbnRTdG9yZVNjaGVtYSh7ZGI6IGNvbm5lY3Rpb259KVxuICB9XG5cbiAgLyoqXG4gICAqIE1vdmVzIGV2ZXJ5IGF0dGFjaG1lbnQgcm93IHRvIGEgcmVjb3JkJ3MgbmV3IHByaW1hcnkta2V5IGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29ubmVjdGlvbiAtIFRyYW5zYWN0aW9uLW93bmluZyBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBBdHRhY2htZW50IG93bmVyIGFmdGVyIHRoZSBrZXkgY2hhbmdlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBhcmdzLm5leHRJZGVudGl0eSAtIE5ldyBvd25lciBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gYXJncy5wcmV2aW91c0lkZW50aXR5IC0gUGVyc2lzdGVkIG93bmVyIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBvd25lcnNoaXAgaXMgbWlncmF0ZWQuXG4gICAqL1xuICBhc3luYyBtaWdyYXRlUmVjb3JkSWRlbnRpdHkoe2Nvbm5lY3Rpb24sIG1vZGVsLCBuZXh0SWRlbnRpdHksIHByZXZpb3VzSWRlbnRpdHl9KSB7XG4gICAgY29uc3QgcHJpbWFyeUtleSA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBuZXh0UmVjb3JkSWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBuZXh0SWRlbnRpdHkpXG4gICAgY29uc3QgcHJldmlvdXNSZWNvcmRJZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHByZXZpb3VzSWRlbnRpdHkpXG5cbiAgICBpZiAobmV4dFJlY29yZElkID09PSBwcmV2aW91c1JlY29yZElkKSByZXR1cm5cblxuICAgIGlmICghYXdhaXQgY29ubmVjdGlvbi50YWJsZUV4aXN0cyhBVFRBQ0hNRU5UU19UQUJMRSkpIHJldHVyblxuXG4gICAgYXdhaXQgY29ubmVjdGlvbi51cGRhdGUoe1xuICAgICAgY29uZGl0aW9uczogYXR0YWNobWVudE93bmVyQ29uZGl0aW9ucyh7XG4gICAgICAgIHJlY29yZElkOiBwcmV2aW91c1JlY29yZElkLFxuICAgICAgICByZWNvcmRUeXBlOiBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICAgIH0pLFxuICAgICAgZGF0YToge1xuICAgICAgICByZWNvcmRfaWQ6IG5leHRSZWNvcmRJZCxcbiAgICAgICAgcmVjb3JkX2lkX2RpZ2VzdDogYXR0YWNobWVudFJlY29yZElkRGlnZXN0KG5leHRSZWNvcmRJZClcbiAgICAgIH0sXG4gICAgICB0YWJsZU5hbWU6IEFUVEFDSE1FTlRTX1RBQkxFXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZSBhdHRhY2htZW50IHJvdyBzdG9yYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5yb3cgLSBBdHRhY2htZW50IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByb3cgc3RvcmFnZSBoYXMgYmVlbiBkZWxldGVkLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlQXR0YWNobWVudFJvd1N0b3JhZ2Uoe21vZGVsLCBuYW1lLCByb3d9KSB7XG4gICAgY29uc3Qgc3RvcmFnZUtleSA9IHR5cGVvZiByb3cuc3RvcmFnZV9rZXkgPT09IFwic3RyaW5nXCIgJiYgcm93LnN0b3JhZ2Vfa2V5Lmxlbmd0aCA+IDAgPyByb3cuc3RvcmFnZV9rZXkgOiBudWxsXG5cbiAgICBpZiAoIXN0b3JhZ2VLZXkpIHJldHVyblxuXG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lLCByb3d9KVxuXG4gICAgaWYgKHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLmRlbGV0ZSAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm5cblxuICAgIGF3YWl0IGF0dGFjaG1lbnREcml2ZXIuZGVsZXRlKHtcbiAgICAgIG1vZGVsLFxuICAgICAgbmFtZSxcbiAgICAgIHJvdyxcbiAgICAgIHN0b3JhZ2VLZXlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFB1cmdlcyBldmVyeSBhdHRhY2htZW50IHN0b3JlZCB1bmRlciAobW9kZWwsIG5hbWUpOiBkZWxldGVzIGVhY2ggcm93J3NcbiAgICogYmFja2luZyBzdG9yYWdlIGFuZCB0aGVuIHJlbW92ZXMgdGhlIGF0dGFjaG1lbnQgcm93cy4gVXNlZCB0byBjbGVhbiB1cCBhblxuICAgKiBvd25lciByZWNvcmQncyBhdHRhY2htZW50cyBiZWZvcmUvd2hlbiB0aGUgb3duZXIgaXMgZGVzdHJveWVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBhdHRhY2htZW50cyBwdXJnZWQuXG4gICAqL1xuICBhc3luYyBwdXJnZUFsbCh7bW9kZWwsIG5hbWV9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeShtb2RlbClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmRUeXBlID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG4gICAgICBjb25zdCByZWNvcmRJZCA9IGF0dGFjaG1lbnRSZWNvcmRJZChtb2RlbClcbiAgICAgIC8qKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgICAgLndoZXJlKGF0dGFjaG1lbnRPd25lckNvbmRpdGlvbnMoe25hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSkpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgLy8gUmVmdXNlIHRvIHB1cmdlIHdoZW4gYW55IHJvdydzIGRyaXZlciBjYW5ub3QgZGVsZXRlIGl0cyBiYWNraW5nIHN0b3JhZ2U6XG4gICAgICAvLyByZW1vdmluZyB0aGUgcm93IHdoaWxlIHRoZSBvYmplY3Qgc3RheXMgYmVoaW5kIHdvdWxkIGxlYWsgc3RvcmFnZSBhbmRcbiAgICAgIC8vIGRpc2NhcmQgdGhlIG1ldGFkYXRhIG5lZWRlZCB0byByZXRyeSBjbGVhbnVwLiBGYWlsIGxvdWRseSBpbnN0ZWFkLlxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyID0gYXdhaXQgdGhpcy5yZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWUsIHJvd30pXG5cbiAgICAgICAgaWYgKHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLmRlbGV0ZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcHVyZ2UgYXR0YWNobWVudCAke3Jvdy5pZH0gZm9yICR7cmVjb3JkVHlwZX0jJHtyZWNvcmRJZH0gKCR7bmFtZX0pOiBpdHMgc3RvcmFnZSBkcml2ZXIgZG9lcyBub3Qgc3VwcG9ydCBkZWxldGlvbi5gKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVBdHRhY2htZW50Um93U3RvcmFnZSh7bW9kZWwsIG5hbWUsIHJvd30pXG4gICAgICAgIC8vIERlbGV0ZSBvbmx5IHRoZSBzbmFwc2hvdHRlZCByb3cgYnkgaWQsIHNvIGFuIGF0dGFjaG1lbnQgaW5zZXJ0ZWQgZm9yIHRoZVxuICAgICAgICAvLyBzYW1lIChyZWNvcmQsIG5hbWUpIGFmdGVyIHRoZSBzbmFwc2hvdCBpcyBub3QgcmVtb3ZlZCB3aXRoIGl0cyBzdG9yYWdlXG4gICAgICAgIC8vIHN0aWxsIHByZXNlbnQgKHdoaWNoIHdvdWxkIGxlYXZlIGl0IGFzIHVucmVhY2hhYmxlIHN0b3JhZ2UpLlxuICAgICAgICBhd2FpdCBkYi5kZWxldGUoe2NvbmRpdGlvbnM6IHtpZDogcm93LmlkfSwgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRX0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByb3dzLmxlbmd0aFxuICAgIH0sIG1vZGVsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkcml2ZXIgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRyaXZlck5hbWUgLSBEcml2ZXIgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBBdHRhY2htZW50IHN0b3JhZ2UgZHJpdmVyIGluc3RhbmNlLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNobWVudERyaXZlckJ5TmFtZShkcml2ZXJOYW1lKSB7XG4gICAgaWYgKHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlOYW1lLmhhcyhkcml2ZXJOYW1lKSkge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5fYXR0YWNobWVudERyaXZlcnNCeU5hbWUuZ2V0KGRyaXZlck5hbWUpKVxuICAgIH1cblxuICAgIGNvbnN0IGF0dGFjaG1lbnRDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbj8uKCkgfHwge31cbiAgICBjb25zdCBjb25maWd1cmVkRHJpdmVyID0gYXR0YWNobWVudENvbmZpZ3VyYXRpb24uZHJpdmVycz8uW2RyaXZlck5hbWVdXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBhdHRhY2htZW50RHJpdmVyLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgbGV0IGF0dGFjaG1lbnREcml2ZXJcblxuICAgIGlmICghY29uZmlndXJlZERyaXZlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBjb25maWd1cmVkIGF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgbmFtZWQgXCIke2RyaXZlck5hbWV9XCJgKVxuICAgIH0gZWxzZSBpZiAoY29uZmlndXJlZERyaXZlci5pbnN0YW5jZSAmJiB0eXBlb2YgY29uZmlndXJlZERyaXZlci5pbnN0YW5jZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgYXR0YWNobWVudERyaXZlciA9IGNvbmZpZ3VyZWREcml2ZXIuaW5zdGFuY2VcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb25maWd1cmVkRHJpdmVyLmRyaXZlckNsYXNzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBuZXcgY29uZmlndXJlZERyaXZlci5kcml2ZXJDbGFzcyh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgbmFtZTogZHJpdmVyTmFtZSxcbiAgICAgICAgb3B0aW9uczogY29uZmlndXJlZERyaXZlclxuICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb25maWd1cmVkRHJpdmVyLmNyZWF0ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhdHRhY2htZW50RHJpdmVyID0gY29uZmlndXJlZERyaXZlci5jcmVhdGUoe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgIG5hbWU6IGRyaXZlck5hbWUsXG4gICAgICAgIG9wdGlvbnM6IGNvbmZpZ3VyZWREcml2ZXJcbiAgICAgIH0pXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCBzdG9yYWdlIGRyaXZlciBcIiR7ZHJpdmVyTmFtZX1cIiBtdXN0IGRlZmluZSBpbnN0YW5jZSwgZHJpdmVyQ2xhc3MsIG9yIGNyZWF0ZWApXG4gICAgfVxuXG4gICAgaWYgKCFhdHRhY2htZW50RHJpdmVyIHx8IHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLndyaXRlICE9PSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIGF0dGFjaG1lbnREcml2ZXIucmVhZCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgXCIke2RyaXZlck5hbWV9XCIgbXVzdCBpbXBsZW1lbnQgd3JpdGUvcmVhZGApXG4gICAgfVxuXG4gICAgdGhpcy5fYXR0YWNobWVudERyaXZlcnNCeU5hbWUuc2V0KGRyaXZlck5hbWUsIGF0dGFjaG1lbnREcml2ZXIpXG5cbiAgICByZXR1cm4gYXR0YWNobWVudERyaXZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkcml2ZXIgYnkgcmVmZXJlbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7QXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmRyaXZlclJlZmVyZW5jZSAtIERyaXZlciBjbGFzcyBvciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEF0dGFjaG1lbnQgZHJpdmVyIGluc3RhbmNlLlxuICAgKi9cbiAgYXR0YWNobWVudERyaXZlckJ5UmVmZXJlbmNlKHthdHRhY2htZW50TmFtZSwgZHJpdmVyUmVmZXJlbmNlLCBtb2RlbENsYXNzfSkge1xuICAgIGlmICh0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5UmVmZXJlbmNlLmhhcyhkcml2ZXJSZWZlcmVuY2UpKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5UmVmZXJlbmNlLmdldChkcml2ZXJSZWZlcmVuY2UpKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlZmluZXMgYXR0YWNobWVudERyaXZlci5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGxldCBhdHRhY2htZW50RHJpdmVyXG5cbiAgICBpZiAodHlwZW9mIGRyaXZlclJlZmVyZW5jZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjb25zdCBEcml2ZXJDbGFzcyA9IC8qKiBAdHlwZSB7QXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yfSAqLyAoZHJpdmVyUmVmZXJlbmNlKVxuXG4gICAgICBhdHRhY2htZW50RHJpdmVyID0gbmV3IERyaXZlckNsYXNzKHtcbiAgICAgICAgYXR0YWNobWVudE5hbWUsXG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgbW9kZWxDbGFzc1xuICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKGRyaXZlclJlZmVyZW5jZSAmJiB0eXBlb2YgZHJpdmVyUmVmZXJlbmNlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBhdHRhY2htZW50RHJpdmVyID0gZHJpdmVyUmVmZXJlbmNlXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBhdHRhY2htZW50IGRyaXZlciByZWZlcmVuY2UgZm9yICR7bW9kZWxDbGFzcy5uYW1lfSMke2F0dGFjaG1lbnROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLndyaXRlICE9PSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIGF0dGFjaG1lbnREcml2ZXIucmVhZCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgZHJpdmVyIGZvciAke21vZGVsQ2xhc3MubmFtZX0jJHthdHRhY2htZW50TmFtZX0gbXVzdCBpbXBsZW1lbnQgd3JpdGUvcmVhZGApXG4gICAgfVxuXG4gICAgdGhpcy5fYXR0YWNobWVudERyaXZlcnNCeVJlZmVyZW5jZS5zZXQoZHJpdmVyUmVmZXJlbmNlLCBhdHRhY2htZW50RHJpdmVyKVxuXG4gICAgcmV0dXJuIGF0dGFjaG1lbnREcml2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgZHJpdmVyIG5hbWUgZm9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgZHJpdmVyIG5hbWUuXG4gICAqL1xuICBfYXR0YWNobWVudERyaXZlck5hbWVGb3Ioe21vZGVsLCBuYW1lfSkge1xuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldEF0dGFjaG1lbnRCeU5hbWUobmFtZSlcbiAgICBjb25zdCBjb25maWd1cmVkRHJpdmVyID0gYXR0YWNobWVudERlZmluaXRpb24uZHJpdmVyXG4gICAgY29uc3QgYXR0YWNobWVudHNDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbj8uKCkgfHwge31cbiAgICBjb25zdCBkZWZhdWx0RHJpdmVyID0gYXR0YWNobWVudHNDb25maWd1cmF0aW9uLmRlZmF1bHREcml2ZXJcblxuICAgIGlmICh0eXBlb2YgY29uZmlndXJlZERyaXZlciA9PT0gXCJzdHJpbmdcIiAmJiBjb25maWd1cmVkRHJpdmVyLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBjb25maWd1cmVkRHJpdmVyXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkRHJpdmVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBjb25maWd1cmVkRHJpdmVyLm5hbWUgfHwgXCJjdXN0b21cIlxuICAgIH1cblxuICAgIGlmIChjb25maWd1cmVkRHJpdmVyICYmIHR5cGVvZiBjb25maWd1cmVkRHJpdmVyID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBjb25zdCBjb25zdHJ1Y3Rvck5hbWUgPSBjb25maWd1cmVkRHJpdmVyLmNvbnN0cnVjdG9yPy5uYW1lXG5cbiAgICAgIGlmICh0eXBlb2YgY29uc3RydWN0b3JOYW1lID09PSBcInN0cmluZ1wiICYmIGNvbnN0cnVjdG9yTmFtZS5sZW5ndGggPiAwICYmIGNvbnN0cnVjdG9yTmFtZSAhPT0gXCJPYmplY3RcIikge1xuICAgICAgICByZXR1cm4gY29uc3RydWN0b3JOYW1lXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBcImN1c3RvbVwiXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBkZWZhdWx0RHJpdmVyID09PSBcInN0cmluZ1wiICYmIGRlZmF1bHREcml2ZXIubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGRlZmF1bHREcml2ZXJcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGF0dGFjaG1lbnQgZHJpdmVyIGNvbmZpZ3VyZWQgZm9yICR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IyR7bmFtZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBhdHRhY2htZW50IGRyaXZlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLnJvd10gLSBBdHRhY2htZW50IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBBdHRhY2htZW50IHN0b3JhZ2UgZHJpdmVyIGluc3RhbmNlLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lLCByb3d9KSB7XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0YWNobWVudEJ5TmFtZShuYW1lKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWREcml2ZXIgPSBhdHRhY2htZW50RGVmaW5pdGlvbi5kcml2ZXJcbiAgICBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIgPT09IFwiZnVuY3Rpb25cIiB8fCAoY29uZmlndXJlZERyaXZlciAmJiB0eXBlb2YgY29uZmlndXJlZERyaXZlciA9PT0gXCJvYmplY3RcIikpIHtcbiAgICAgIHJldHVybiB0aGlzLmF0dGFjaG1lbnREcml2ZXJCeVJlZmVyZW5jZSh7XG4gICAgICAgIGF0dGFjaG1lbnROYW1lOiBuYW1lLFxuICAgICAgICBkcml2ZXJSZWZlcmVuY2U6IGNvbmZpZ3VyZWREcml2ZXIsXG4gICAgICAgIG1vZGVsQ2xhc3M6IG1vZGVsLmdldE1vZGVsQ2xhc3MoKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCBmYWxsYmFja0RyaXZlck5hbWUgPSB0eXBlb2Ygcm93Py5kcml2ZXIgPT09IFwic3RyaW5nXCIgJiYgcm93LmRyaXZlci5sZW5ndGggPiAwXG4gICAgICA/IHJvdy5kcml2ZXJcbiAgICAgIDogdGhpcy5fYXR0YWNobWVudERyaXZlck5hbWVGb3Ioe21vZGVsLCBuYW1lfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmF0dGFjaG1lbnREcml2ZXJCeU5hbWUoZmFsbGJhY2tEcml2ZXJOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBwb3NpdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gREIgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVjb3JkSWQgLSBSZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlY29yZFR5cGUgLSBSZWNvcmQgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBOZXh0IHBvc2l0aW9uLlxuICAgKi9cbiAgYXN5bmMgX25leHRQb3NpdGlvbih7ZGIsIG5hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgIC53aGVyZShhdHRhY2htZW50T3duZXJDb25kaXRpb25zKHtuYW1lLCByZWNvcmRJZCwgcmVjb3JkVHlwZX0pKVxuICAgICAgLm9yZGVyKFwicG9zaXRpb24gREVTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgIGNvbnN0IGN1cnJlbnRSb3cgPSAvKiogQHR5cGUge3twb3NpdGlvbj86IHN0cmluZyB8IG51bWJlciB8IG51bGx9IHwgdW5kZWZpbmVkfSAqLyAocm93c1swXSlcbiAgICBjb25zdCBjdXJyZW50ID0gTnVtYmVyKGN1cnJlbnRSb3c/LnBvc2l0aW9uKVxuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoY3VycmVudCkpIHJldHVybiAwXG5cbiAgICByZXR1cm4gY3VycmVudCArIDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggZGIuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBbbW9kZWxdIC0gT3BlcmF0aW9uLW93bmluZyBtb2RlbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhEYihjYWxsYmFjaywgbW9kZWwpIHtcbiAgICBpZiAobW9kZWwgJiYgbW9kZWwuZGF0YWJhc2VPcGVyYXRpb24oKSkgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG1vZGVsLmNvbm5lY3Rpb24oKSlcblxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIC8qKlxuICAgICAqIERlZmluZXMgcmVzdWx0LlxuICAgICAqIEB0eXBlIHtUIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCByZXN1bHRcblxuICAgIGF3YWl0IHBvb2wud2l0aENvbm5lY3Rpb24oe25hbWU6IFwiUmVjb3JkIGF0dGFjaG1lbnQgc3RvcmVcIn0sIGFzeW5jIChkYikgPT4ge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgfSlcblxuICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovIChyZXN1bHQpXG4gIH1cbn1cbiJdfQ==