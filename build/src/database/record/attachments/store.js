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
/** SQL Server deadlock victim — raised when concurrent sessions deadlock on the same catalog reads. */
const MSSQL_DEADLOCK_VICTIM_ERROR_NUMBER = 1205;
/** Retry budget for transient catalog deadlocks while bootstrapping attachment schema. */
const ATTACHMENT_SCHEMA_MAX_ATTEMPTS = 3;
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
/**
 * Returns whether an error means a concurrent process created the same schema object.
 *
 * Drivers report this differently: SQLite raises "index ... already exists", MSSQL raises
 * "There is already an object named ..." (2714), PostgreSQL raises DuplicateTable (42P07) or
 * DuplicateObject (42710). Matching on the message keeps the check driver-agnostic without
 * hiding unrelated failures.
 * @param {unknown} error - Thrown error.
 * @returns {boolean} - Whether this is a concurrent-creation collision.
 */
function isConcurrentSchemaCreationError(error) {
    if (!error)
        return false;
    const code = typeof error === "object" && "number" in error ? Number(error.number) : NaN;
    // MSSQL 2714 (duplicate object), 1913 (duplicate index); PostgreSQL 42P07 / 42710.
    if (code === 2714 || code === 1913 || code === 42)
        return true;
    const message = error instanceof Error ? error.message : String(error);
    return /already exists/i.test(message) || /already an object named/i.test(message) || /duplicate (table|object|key)/i.test(message);
}
/**
 * Whether an error is a retryable database deadlock victim.
 *
 * Matched by numeric error number, never by message text: SQL Server raises 1205 when a
 * concurrent session wins the lock and this one is chosen as the victim. The victim's
 * transaction has already rolled back, so the operation is safe to retry.
 * @param {unknown} error - Thrown error.
 * @returns {boolean} - Whether this is a retryable deadlock victim.
 */
function isDeadlockVictimError(error) {
    let current = error;
    while (current instanceof Error) {
        const errorNumber = /** @type {{number?: unknown}} */ (current).number;
        if (typeof errorNumber === "number" && errorNumber === MSSQL_DEADLOCK_VICTIM_ERROR_NUMBER)
            return true;
        current = current.cause;
    }
    return false;
}
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
        let attempt = 0;
        while (true) {
            attempt++;
            try {
                await db.createTable(table);
                break;
            }
            catch (error) {
                // A concurrent process may win the create between our tableExists() check and this
                // call. createTable guards the table with ifNotExists but NOT its indexes, so the
                // loser fails with a duplicate-object error. Treat that as "someone else bootstrapped
                // it": reconcile through the upgrade path instead of failing the caller.
                if (isConcurrentSchemaCreationError(error)) {
                    await this.ensureAttachmentStoreSchema({ db });
                    return;
                }
                // Concurrent boots also deadlock on the INFORMATION_SCHEMA metadata scan that
                // getTableByName performs on SQL Server. The victim transaction rolled back cleanly,
                // so retrying it is safe. Without this the loser takes down its caller even though
                // another process is building the very table it needs.
                if (isDeadlockVictimError(error) && attempt < ATTACHMENT_SCHEMA_MAX_ATTEMPTS) {
                    db.clearSchemaCache();
                    continue;
                }
                throw error;
            }
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F0dGFjaG1lbnRzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMkJBQTJCLENBQUE7QUFDakQsT0FBTyxVQUFVLE1BQU0saUNBQWlDLENBQUE7QUFDeEQsT0FBTyxFQUFDLHVCQUF1QixFQUFDLE1BQU0scUNBQXFDLENBQUE7QUFDM0UsT0FBTyxTQUFTLE1BQU0sOEJBQThCLENBQUE7QUFDcEQsT0FBTyw4QkFBOEIsTUFBTSxzQkFBc0IsQ0FBQTtBQUVqRTs7a0hBRWtIO0FBQ2xILE1BQU0saUJBQWlCLEdBQUcsdUJBQXVCLENBQUE7QUFDakQsTUFBTSwyQkFBMkIsR0FBRyxpRUFBaUUsQ0FBQTtBQUNyRyxNQUFNLGtDQUFrQyxHQUFHLEVBQUUsQ0FBQTtBQUM3QyxNQUFNLGdEQUFnRCxHQUFHLEdBQUcsQ0FBQTtBQUM1RCxNQUFNLDJCQUEyQixHQUFHLDhCQUE4QixDQUFBO0FBQ2xFLHVHQUF1RztBQUN2RyxNQUFNLGtDQUFrQyxHQUFHLElBQUksQ0FBQTtBQUMvQywwRkFBMEY7QUFDMUYsTUFBTSw4QkFBOEIsR0FBRyxDQUFDLENBQUE7QUFFeEM7O3VHQUV1RztBQUN2RyxNQUFNLHFCQUFxQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFM0M7OztHQUdHO0FBQ0gsU0FBUyxZQUFZO0lBQ25CLE9BQU8sSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUE7QUFDN0IsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGtCQUFrQixDQUFDLEtBQUs7SUFDL0IsT0FBTyx1QkFBdUIsQ0FBQyxLQUFLLENBQUMsYUFBYSxFQUFFLENBQUMsVUFBVSxFQUFFLEVBQUUsS0FBSyxDQUFD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VUFBVSxFQUFFLENBQUMsQ0FBQTtRQUVqRixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtRQUN4RTs7bUNBRTJCO1FBQzNCLElBQUksTUFBTSxDQUFBO1FBRVYsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFDLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO1lBQ3hFLE1BQU0sR0FBRyxNQUFNLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUM3QixDQUFDLENBQUMsQ0FBQTtRQUVGLE9BQU8sZ0JBQWdCLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNsQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi8uLi90YWJsZS1kYXRhL2luZGV4LmpzXCJcbmltcG9ydCBUYWJsZUluZGV4IGZyb20gXCIuLi8uLi90YWJsZS1kYXRhL3RhYmxlLWluZGV4LmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXl9IGZyb20gXCIuLi8uLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQgc2hhMjU2SGV4IGZyb20gXCIuLi8uLi8uLi91dGlscy9zaGEyNTYtaGV4LmpzXCJcbmltcG9ydCBub3JtYWxpemVSZWNvcmRBdHRhY2htZW50SW5wdXQgZnJvbSBcIi4vbm9ybWFsaXplLWlucHV0LmpzXCJcblxuLyoqXG4gKiBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3Rvcn0gQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yICovXG5jb25zdCBBVFRBQ0hNRU5UU19UQUJMRSA9IFwidmVsb2Npb3VzX2F0dGFjaG1lbnRzXCJcbmNvbnN0IEFUVEFDSE1FTlRfT1dORVJfSU5ERVhfTkFNRSA9IFwiaW5kZXhfdmVsb2Npb3VzX2F0dGFjaG1lbnRzX29uX3JlY29yZF90eXBlX2FuZF9yZWNvcmRfaWRfZGlnZXN0XCJcbmNvbnN0IEFUVEFDSE1FTlRfUkVDT1JEX0lEX0RJR0VTVF9MRU5HVEggPSA2NFxuY29uc3QgQVRUQUNITUVOVF9SRUNPUkRfSURfRElHRVNUX01JR1JBVElPTl9CQVRDSF9TSVpFID0gMTAwXG5jb25zdCBBVFRBQ0hNRU5UX1NDSEVNQV9MT0NLX05BTUUgPSBcInZlbG9jaW91cy1hdHRhY2htZW50cy1zY2hlbWFcIlxuLyoqIFNRTCBTZXJ2ZXIgZGVhZGxvY2sgdmljdGltIOKAlCByYWlzZWQgd2hlbiBjb25jdXJyZW50IHNlc3Npb25zIGRlYWRsb2NrIG9uIHRoZSBzYW1lIGNhdGFsb2cgcmVhZHMuICovXG5jb25zdCBNU1NRTF9ERUFETE9DS19WSUNUSU1fRVJST1JfTlVNQkVSID0gMTIwNVxuLyoqIFJldHJ5IGJ1ZGdldCBmb3IgdHJhbnNpZW50IGNhdGFsb2cgZGVhZGxvY2tzIHdoaWxlIGJvb3RzdHJhcHBpbmcgYXR0YWNobWVudCBzY2hlbWEuICovXG5jb25zdCBBVFRBQ0hNRU5UX1NDSEVNQV9NQVhfQVRURU1QVFMgPSAzXG5cbi8qKlxuICogU3RvcmVzIGJ5IGNvbmZpZ3VyYXRpb24uXG4gKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi8uLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRzU3RvcmU+Pn0gKi9cbmNvbnN0IHN0b3Jlc0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBSdW5zIGdlbmVyYXRlIHV1aWQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEdlbmVyYXRlZCBVVUlEIHY0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVVVSUQoKSB7XG4gIHJldHVybiBuZXcgVVVJRCg0KS5mb3JtYXQoKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNhbm9uaWNhbCBzdG9yZWQgb3duZXIgaWRlbnRpdHkgZm9yIGEgbW9kZWwgYXR0YWNobWVudC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBBdHRhY2htZW50IG93bmVyLlxuICogQHJldHVybnMge3N0cmluZ30gLSBDYW5vbmljYWwgb3duZXIgaWRlbnRpdHkuXG4gKi9cbmZ1bmN0aW9uIGF0dGFjaG1lbnRSZWNvcmRJZChtb2RlbCkge1xuICByZXR1cm4gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkobW9kZWwuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKSwgbW9kZWwuaWQoKSlcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgYm91bmRlZCBkaWdlc3QgZm9yIGluZGV4ZWQgYXR0YWNobWVudCBvd25lciBsb29rdXBzLlxuICogQHBhcmFtIHtzdHJpbmd9IHJlY29yZElkIC0gQ2Fub25pY2FsIGF0dGFjaG1lbnQgb3duZXIgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNIQS0yNTYgZGlnZXN0LlxuICovXG5mdW5jdGlvbiBhdHRhY2htZW50UmVjb3JkSWREaWdlc3QocmVjb3JkSWQpIHtcbiAgcmV0dXJuIHNoYTI1NkhleChyZWNvcmRJZClcbn1cblxuLyoqXG4gKiBCdWlsZHMgY29sbGlzaW9uLXNhZmUgYXR0YWNobWVudCBvd25lciBsb29rdXAgY29uZGl0aW9ucy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3duZXIgbG9va3VwIHZhbHVlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5uYW1lXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlY29yZElkIC0gQ2Fub25pY2FsIG93bmVyIGlkZW50aXR5LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVjb3JkVHlwZSAtIE93bmVyIG1vZGVsIG5hbWUuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBJbmRleGVkIGRpZ2VzdCBhbmQgY2Fub25pY2FsIGlkZW50aXR5IGNvbmRpdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIGF0dGFjaG1lbnRPd25lckNvbmRpdGlvbnMoe25hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSkge1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gIGNvbnN0IGNvbmRpdGlvbnMgPSB7XG4gICAgcmVjb3JkX2lkOiByZWNvcmRJZCxcbiAgICByZWNvcmRfaWRfZGlnZXN0OiBhdHRhY2htZW50UmVjb3JkSWREaWdlc3QocmVjb3JkSWQpLFxuICAgIHJlY29yZF90eXBlOiByZWNvcmRUeXBlXG4gIH1cblxuICBpZiAobmFtZSAhPT0gdW5kZWZpbmVkKSBjb25kaXRpb25zLm5hbWUgPSBuYW1lXG5cbiAgcmV0dXJuIGNvbmRpdGlvbnNcbn1cblxuLyoqXG4gKiBSdW5zIHN0b3JlIGtleSBmb3IgbW9kZWwuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFN0b3JlIGtleS5cbiAqL1xuZnVuY3Rpb24gc3RvcmVLZXlGb3JNb2RlbChtb2RlbCkge1xuICBjb25zdCBvcGVyYXRpb24gPSBtb2RlbC5kYXRhYmFzZU9wZXJhdGlvbigpXG5cbiAgaWYgKG9wZXJhdGlvbikgcmV0dXJuIG9wZXJhdGlvbi5kYXRhYmFzZUlkZW50aXR5KClcblxuICByZXR1cm4gYCR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldERhdGFiYXNlSWRlbnRpZmllcigpfWBcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBwaHlzaWNhbCBzdG9yZSBrZXkgZm9yIGFuIGFscmVhZHktc2VsZWN0ZWQgbW9kZWwgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBTZWxlY3RlZCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICogQHJldHVybnMge3N0cmluZ30gLSBQaHlzaWNhbCBzdG9yZSBrZXkuXG4gKi9cbmZ1bmN0aW9uIHN0b3JlS2V5Rm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzLCBjb25uZWN0aW9uKSB7XG4gIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IG1vZGVsQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgY29uc3QgcmV1c2VLZXkgPSBtb2RlbENsYXNzXG4gICAgLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICAuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICAuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjb25uZWN0aW9uKVxuXG4gIHJldHVybiBgJHtkYXRhYmFzZUlkZW50aWZpZXJ9OiR7cmV1c2VLZXl9YFxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIHNoYXJlZCBhdHRhY2htZW50IHN0b3JlIGZvciBvbmUgY29uZmlndXJlZCBkYXRhYmFzZSBpZGVudGl0eS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU3RvcmUgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gT3duaW5nIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZUlkZW50aWZpZXIgLSBMb2dpY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdG9yZUtleSAtIFBoeXNpY2FsIHN0b3JlIGtleS5cbiAqIEByZXR1cm5zIHtSZWNvcmRBdHRhY2htZW50c1N0b3JlfSAtIFNoYXJlZCBzdG9yZSBpbnN0YW5jZS5cbiAqL1xuZnVuY3Rpb24gcmVjb3JkQXR0YWNobWVudHNTdG9yZSh7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyLCBzdG9yZUtleX0pIHtcbiAgbGV0IHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyID0gc3RvcmVzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gIGlmICghc3RvcmVzQnlEYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICBzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllciA9IG5ldyBNYXAoKVxuICAgIHN0b3Jlc0J5Q29uZmlndXJhdGlvbi5zZXQoY29uZmlndXJhdGlvbiwgc3RvcmVzQnlEYXRhYmFzZUlkZW50aWZpZXIpXG4gIH1cblxuICBsZXQgc3RvcmUgPSBzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllci5nZXQoc3RvcmVLZXkpXG5cbiAgaWYgKHN0b3JlKSByZXR1cm4gc3RvcmVcblxuICBzdG9yZSA9IG5ldyBSZWNvcmRBdHRhY2htZW50c1N0b3JlKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXJ9KVxuICBzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllci5zZXQoc3RvcmVLZXksIHN0b3JlKVxuXG4gIHJldHVybiBzdG9yZVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgc3RvcmUgdXNlZCBiZWZvcmUgYSBtb2RlbC1sZXZlbCB0cmFuc2FjdGlvbiBzdGFydHMuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3Mgb3BlbmluZyB0aGUgdHJhbnNhY3Rpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gU2VsZWN0ZWQgcGh5c2ljYWwgY29ubmVjdGlvbi5cbiAqIEByZXR1cm5zIHtSZWNvcmRBdHRhY2htZW50c1N0b3JlfSAtIFN0b3JlIGluc3RhbmNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkQXR0YWNobWVudHNTdG9yZUZvck1vZGVsQ2xhc3MobW9kZWxDbGFzcywgY29ubmVjdGlvbikge1xuICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG5cbiAgcmV0dXJuIHJlY29yZEF0dGFjaG1lbnRzU3RvcmUoe1xuICAgIGNvbmZpZ3VyYXRpb246IG1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKSxcbiAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgc3RvcmVLZXk6IHN0b3JlS2V5Rm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzLCBjb25uZWN0aW9uKVxuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIHJlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbCBoZWxwZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7UmVjb3JkQXR0YWNobWVudHNTdG9yZX0gLSBTdG9yZSBpbnN0YW5jZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbChtb2RlbCkge1xuICBjb25zdCBjb25maWd1cmF0aW9uID0gbW9kZWwuX2dldENvbmZpZ3VyYXRpb24oKVxuICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbC5kYXRhYmFzZU9wZXJhdGlvbigpPy5kYXRhYmFzZUlkZW50aWZpZXIoKSB8fCBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcblxuICByZXR1cm4gcmVjb3JkQXR0YWNobWVudHNTdG9yZSh7XG4gICAgY29uZmlndXJhdGlvbixcbiAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgc3RvcmVLZXk6IHN0b3JlS2V5Rm9yTW9kZWwobW9kZWwpXG4gIH0pXG59XG5cbi8qKlxuICogQXR0YWNobWVudCBwZXJzaXN0ZW5jZSBzdG9yZS5cbiAqL1xuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgYW4gZXJyb3IgbWVhbnMgYSBjb25jdXJyZW50IHByb2Nlc3MgY3JlYXRlZCB0aGUgc2FtZSBzY2hlbWEgb2JqZWN0LlxuICpcbiAqIERyaXZlcnMgcmVwb3J0IHRoaXMgZGlmZmVyZW50bHk6IFNRTGl0ZSByYWlzZXMgXCJpbmRleCAuLi4gYWxyZWFkeSBleGlzdHNcIiwgTVNTUUwgcmFpc2VzXG4gKiBcIlRoZXJlIGlzIGFscmVhZHkgYW4gb2JqZWN0IG5hbWVkIC4uLlwiICgyNzE0KSwgUG9zdGdyZVNRTCByYWlzZXMgRHVwbGljYXRlVGFibGUgKDQyUDA3KSBvclxuICogRHVwbGljYXRlT2JqZWN0ICg0MjcxMCkuIE1hdGNoaW5nIG9uIHRoZSBtZXNzYWdlIGtlZXBzIHRoZSBjaGVjayBkcml2ZXItYWdub3N0aWMgd2l0aG91dFxuICogaGlkaW5nIHVucmVsYXRlZCBmYWlsdXJlcy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBUaHJvd24gZXJyb3IuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgaXMgYSBjb25jdXJyZW50LWNyZWF0aW9uIGNvbGxpc2lvbi5cbiAqL1xuZnVuY3Rpb24gaXNDb25jdXJyZW50U2NoZW1hQ3JlYXRpb25FcnJvcihlcnJvcikge1xuICBpZiAoIWVycm9yKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBjb2RlID0gdHlwZW9mIGVycm9yID09PSBcIm9iamVjdFwiICYmIFwibnVtYmVyXCIgaW4gZXJyb3IgPyBOdW1iZXIoZXJyb3IubnVtYmVyKSA6IE5hTlxuXG4gIC8vIE1TU1FMIDI3MTQgKGR1cGxpY2F0ZSBvYmplY3QpLCAxOTEzIChkdXBsaWNhdGUgaW5kZXgpOyBQb3N0Z3JlU1FMIDQyUDA3IC8gNDI3MTAuXG4gIGlmIChjb2RlID09PSAyNzE0IHx8IGNvZGUgPT09IDE5MTMgfHwgY29kZSA9PT0gNDIpIHJldHVybiB0cnVlXG5cbiAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuXG4gIHJldHVybiAvYWxyZWFkeSBleGlzdHMvaS50ZXN0KG1lc3NhZ2UpIHx8IC9hbHJlYWR5IGFuIG9iamVjdCBuYW1lZC9pLnRlc3QobWVzc2FnZSkgfHwgL2R1cGxpY2F0ZSAodGFibGV8b2JqZWN0fGtleSkvaS50ZXN0KG1lc3NhZ2UpXG59XG5cbi8qKlxuICogV2hldGhlciBhbiBlcnJvciBpcyBhIHJldHJ5YWJsZSBkYXRhYmFzZSBkZWFkbG9jayB2aWN0aW0uXG4gKlxuICogTWF0Y2hlZCBieSBudW1lcmljIGVycm9yIG51bWJlciwgbmV2ZXIgYnkgbWVzc2FnZSB0ZXh0OiBTUUwgU2VydmVyIHJhaXNlcyAxMjA1IHdoZW4gYVxuICogY29uY3VycmVudCBzZXNzaW9uIHdpbnMgdGhlIGxvY2sgYW5kIHRoaXMgb25lIGlzIGNob3NlbiBhcyB0aGUgdmljdGltLiBUaGUgdmljdGltJ3NcbiAqIHRyYW5zYWN0aW9uIGhhcyBhbHJlYWR5IHJvbGxlZCBiYWNrLCBzbyB0aGUgb3BlcmF0aW9uIGlzIHNhZmUgdG8gcmV0cnkuXG4gKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gVGhyb3duIGVycm9yLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIGlzIGEgcmV0cnlhYmxlIGRlYWRsb2NrIHZpY3RpbS5cbiAqL1xuZnVuY3Rpb24gaXNEZWFkbG9ja1ZpY3RpbUVycm9yKGVycm9yKSB7XG4gIGxldCBjdXJyZW50ID0gZXJyb3JcblxuICB3aGlsZSAoY3VycmVudCBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgY29uc3QgZXJyb3JOdW1iZXIgPSAvKiogQHR5cGUge3tudW1iZXI/OiB1bmtub3dufX0gKi8gKGN1cnJlbnQpLm51bWJlclxuXG4gICAgaWYgKHR5cGVvZiBlcnJvck51bWJlciA9PT0gXCJudW1iZXJcIiAmJiBlcnJvck51bWJlciA9PT0gTVNTUUxfREVBRExPQ0tfVklDVElNX0VSUk9SX05VTUJFUikgcmV0dXJuIHRydWVcblxuICAgIGN1cnJlbnQgPSBjdXJyZW50LmNhdXNlXG4gIH1cblxuICByZXR1cm4gZmFsc2Vcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgUmVjb3JkQXR0YWNobWVudHNTdG9yZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZUlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcn0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgdGhpcy5fc2NoZW1hVXBncmFkZVByb21pc2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc2NoZW1hUmVhZHlHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fZHJpdmVyQ29sdW1uc0F2YWlsYWJsZSA9IGZhbHNlXG4gICAgdGhpcy5fY29udGVudEJhc2U2NE51bGxhYmxlID0gdHJ1ZVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5TmFtZSA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5UmVmZXJlbmNlID0gbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgcmVhZHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gW21vZGVsXSAtIE9wZXJhdGlvbi1vd25pbmcgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2NoZW1hIGlzIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkobW9kZWwpIHtcbiAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlKSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuZW5zdXJlU2NoZW1hKGRiKVxuICAgICAgfSwgbW9kZWwpXG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYXR0YWNobWVudCBzY2hlbWEgdGhyb3VnaCBhbiBhbHJlYWR5LW93bmVkIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzY2hlbWEgaXMgcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVTY2hlbWEoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoQVRUQUNITUVOVFNfVEFCTEUpKSB7XG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZUF0dGFjaG1lbnRTdG9yZVNjaGVtYSh7ZGJ9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKEFUVEFDSE1FTlRTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwiaWRcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJyZWNvcmRfdHlwZVwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwicmVjb3JkX2lkXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwicmVjb3JkX2lkX2RpZ2VzdFwiLCB7bWF4TGVuZ3RoOiBBVFRBQ0hNRU5UX1JFQ09SRF9JRF9ESUdFU1RfTEVOR1RILCBudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwibmFtZVwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwicG9zaXRpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJmaWxlbmFtZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImNvbnRlbnRfdHlwZVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiYnl0ZV9zaXplXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiZHJpdmVyXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzdG9yYWdlX2tleVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImNvbnRlbnRfYmFzZTY0XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwidXBkYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInJlY29yZF90eXBlXCIsIFwicmVjb3JkX2lkX2RpZ2VzdFwiXSwge25hbWU6IEFUVEFDSE1FTlRfT1dORVJfSU5ERVhfTkFNRX0pKVxuXG4gICAgbGV0IGF0dGVtcHQgPSAwXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgYXR0ZW1wdCsrXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuXG4gICAgICAgIGJyZWFrXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBBIGNvbmN1cnJlbnQgcHJvY2VzcyBtYXkgd2luIHRoZSBjcmVhdGUgYmV0d2VlbiBvdXIgdGFibGVFeGlzdHMoKSBjaGVjayBhbmQgdGhpc1xuICAgICAgICAvLyBjYWxsLiBjcmVhdGVUYWJsZSBndWFyZHMgdGhlIHRhYmxlIHdpdGggaWZOb3RFeGlzdHMgYnV0IE5PVCBpdHMgaW5kZXhlcywgc28gdGhlXG4gICAgICAgIC8vIGxvc2VyIGZhaWxzIHdpdGggYSBkdXBsaWNhdGUtb2JqZWN0IGVycm9yLiBUcmVhdCB0aGF0IGFzIFwic29tZW9uZSBlbHNlIGJvb3RzdHJhcHBlZFxuICAgICAgICAvLyBpdFwiOiByZWNvbmNpbGUgdGhyb3VnaCB0aGUgdXBncmFkZSBwYXRoIGluc3RlYWQgb2YgZmFpbGluZyB0aGUgY2FsbGVyLlxuICAgICAgICBpZiAoaXNDb25jdXJyZW50U2NoZW1hQ3JlYXRpb25FcnJvcihlcnJvcikpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmVuc3VyZUF0dGFjaG1lbnRTdG9yZVNjaGVtYSh7ZGJ9KVxuXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb25jdXJyZW50IGJvb3RzIGFsc28gZGVhZGxvY2sgb24gdGhlIElORk9STUFUSU9OX1NDSEVNQSBtZXRhZGF0YSBzY2FuIHRoYXRcbiAgICAgICAgLy8gZ2V0VGFibGVCeU5hbWUgcGVyZm9ybXMgb24gU1FMIFNlcnZlci4gVGhlIHZpY3RpbSB0cmFuc2FjdGlvbiByb2xsZWQgYmFjayBjbGVhbmx5LFxuICAgICAgICAvLyBzbyByZXRyeWluZyBpdCBpcyBzYWZlLiBXaXRob3V0IHRoaXMgdGhlIGxvc2VyIHRha2VzIGRvd24gaXRzIGNhbGxlciBldmVuIHRob3VnaFxuICAgICAgICAvLyBhbm90aGVyIHByb2Nlc3MgaXMgYnVpbGRpbmcgdGhlIHZlcnkgdGFibGUgaXQgbmVlZHMuXG4gICAgICAgIGlmIChpc0RlYWRsb2NrVmljdGltRXJyb3IoZXJyb3IpICYmIGF0dGVtcHQgPCBBVFRBQ0hNRU5UX1NDSEVNQV9NQVhfQVRURU1QVFMpIHtcbiAgICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcblxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2RyaXZlckNvbHVtbnNBdmFpbGFibGUgPSB0cnVlXG4gICAgdGhpcy5fY29udGVudEJhc2U2NE51bGxhYmxlID0gdHJ1ZVxuICAgIHRoaXMuX3NjaGVtYVJlYWR5R2VuZXJhdGlvbiA9IHRoaXMuX3NjaGVtYUNhY2hlR2VuZXJhdGlvbihkYilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5pbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5yZXBsYWNlIC0gV2hldGhlciB0byByZXBsYWNlIGV4aXN0aW5nIGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNoKHtpbnB1dCwgbW9kZWwsIG5hbWUsIHJlcGxhY2V9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeShtb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uPy4oKSB8fCB7fVxuICAgIGNvbnN0IGFsbG93UGF0aElucHV0ID0gYXR0YWNobWVudHNDb25maWd1cmF0aW9uLmFsbG93UGF0aElucHV0ID09PSB0cnVlXG4gICAgY29uc3QgYWxsb3dlZFBhdGhQcmVmaXhlcyA9IEFycmF5LmlzQXJyYXkoYXR0YWNobWVudHNDb25maWd1cmF0aW9uLmFsbG93ZWRQYXRoUHJlZml4ZXMpXG4gICAgICA/IGF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbi5hbGxvd2VkUGF0aFByZWZpeGVzXG4gICAgICA6IHVuZGVmaW5lZFxuXG4gICAgY29uc3Qgbm9ybWFsaXplZElucHV0ID0gYXdhaXQgbm9ybWFsaXplUmVjb3JkQXR0YWNobWVudElucHV0KGlucHV0LCB7XG4gICAgICBhbGxvd1BhdGhJbnB1dCxcbiAgICAgIGFsbG93ZWRQYXRoUHJlZml4ZXMsXG4gICAgICBlbnZpcm9ubWVudEhhbmRsZXI6IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIH0pXG4gICAgLyoqXG4gICAgICogQXR0YWNobWVudCBwZXJzaXN0ZW5jZSBlcnJvci5cbiAgICAgKiBUaGlzIHN0YXlzIG9wYXF1ZSBzbyBhbnkgSmF2YVNjcmlwdCB0aHJvd24gdmFsdWUgaXMgcHJlc2VydmVkIGV4YWN0bHkuXG4gICAgICogQHR5cGUge3Vua25vd259ICovXG4gICAgbGV0IHBlcnNpc3RlbmNlRXJyb3IgPSBudWxsXG4gICAgbGV0IHBlcnNpc3RlbmNlRmFpbGVkID0gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwZXJzaXN0ZW5jZUlucHV0ID0gYXdhaXQgdGhpcy5wZXJzaXN0ZW5jZUlucHV0Rm9yKG5vcm1hbGl6ZWRJbnB1dClcblxuICAgICAgYXdhaXQgdGhpcy5wZXJzaXN0Tm9ybWFsaXplZEF0dGFjaG1lbnQoe1xuICAgICAgICBtb2RlbCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgbm9ybWFsaXplZElucHV0OiBwZXJzaXN0ZW5jZUlucHV0LFxuICAgICAgICByZXBsYWNlXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBwZXJzaXN0ZW5jZUZhaWxlZCA9IHRydWVcbiAgICAgIHBlcnNpc3RlbmNlRXJyb3IgPSBlcnJvclxuICAgIH1cblxuICAgIGlmIChub3JtYWxpemVkSW5wdXQucGF0aFNvdXJjZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgbm9ybWFsaXplZElucHV0LnBhdGhTb3VyY2UuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICBpZiAocGVyc2lzdGVuY2VGYWlsZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbcGVyc2lzdGVuY2VFcnJvciwgY2xvc2VFcnJvcl0sXG4gICAgICAgICAgICBgQXR0YWNobWVudCBwZXJzaXN0ZW5jZSBhbmQgcGF0aC1zb3VyY2UgY2xvc2UgYm90aCBmYWlsZWQgZm9yICR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpfSMke2F0dGFjaG1lbnRSZWNvcmRJZChtb2RlbCl9ICgke25hbWV9KWAsXG4gICAgICAgICAgICB7Y2F1c2U6IGNsb3NlRXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgY2xvc2VFcnJvclxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwZXJzaXN0ZW5jZUZhaWxlZCkgdGhyb3cgcGVyc2lzdGVuY2VFcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIE1hdGVyaWFsaXplcyBwYXRoIGNvbnRlbnQgb25jZSB3aGVuIGEgbGVnYWN5IHNjaGVtYSByZXF1aXJlcyBCYXNlNjQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dH0gbm9ybWFsaXplZElucHV0IC0gTm9ybWFsaXplZCBhdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL25vcm1hbGl6ZS1pbnB1dC5qc1wiKS5Ob3JtYWxpemVkQXR0YWNobWVudElucHV0Pn0gLSBJbnB1dCB1c2VkIGJ5IHRoZSBkcml2ZXIgYW5kIGRhdGFiYXNlLlxuICAgKi9cbiAgYXN5bmMgcGVyc2lzdGVuY2VJbnB1dEZvcihub3JtYWxpemVkSW5wdXQpIHtcbiAgICBpZiAodGhpcy5fY29udGVudEJhc2U2NE51bGxhYmxlIHx8ICFub3JtYWxpemVkSW5wdXQucGF0aFNvdXJjZSkgcmV0dXJuIG5vcm1hbGl6ZWRJbnB1dFxuXG4gICAgY29uc3QgY29udGVudEJ1ZmZlciA9IGF3YWl0IG5vcm1hbGl6ZWRJbnB1dC5wYXRoU291cmNlLnJlYWRCdWZmZXIoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLm5vcm1hbGl6ZWRJbnB1dCxcbiAgICAgIGNvbnRlbnRCYXNlNjQ6IGNvbnRlbnRCdWZmZXIudG9TdHJpbmcoXCJiYXNlNjRcIiksXG4gICAgICBjb250ZW50QnVmZmVyLFxuICAgICAgcGF0aFNvdXJjZTogbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBvbmUgbm9ybWFsaXplZCBhdHRhY2htZW50IHdoaWxlIGl0cyBwYXRoIHNvdXJjZSByZW1haW5zIG9wZW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dH0gYXJncy5ub3JtYWxpemVkSW5wdXQgLSBOb3JtYWxpemVkIGF0dGFjaG1lbnQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5yZXBsYWNlIC0gV2hldGhlciB0byByZXBsYWNlIGV4aXN0aW5nIGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHBlcnNpc3ROb3JtYWxpemVkQXR0YWNobWVudCh7bW9kZWwsIG5hbWUsIG5vcm1hbGl6ZWRJbnB1dCwgcmVwbGFjZX0pIHtcbiAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyID0gYXdhaXQgdGhpcy5yZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWV9KVxuICAgIGNvbnN0IGF0dGFjaG1lbnREcml2ZXJOYW1lID0gdGhpcy5fYXR0YWNobWVudERyaXZlck5hbWVGb3Ioe21vZGVsLCBuYW1lfSlcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpXG4gICAgY29uc3QgcmVjb3JkVHlwZSA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIGNvbnN0IHJlY29yZElkID0gYXR0YWNobWVudFJlY29yZElkKG1vZGVsKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRJZCA9IGdlbmVyYXRlVVVJRCgpXG4gICAgLyoqXG4gICAgICogV3JpdHRlbiBzdG9yYWdlIGtleS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgICBsZXQgc3RvcmFnZUtleSA9IG51bGxcbiAgICBsZXQgcm93UGVyc2lzdGVkID0gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCB3cml0ZVJlc3VsdCA9IGF3YWl0IGF0dGFjaG1lbnREcml2ZXIud3JpdGUoe1xuICAgICAgICBhdHRhY2htZW50SWQsXG4gICAgICAgIGlucHV0OiBub3JtYWxpemVkSW5wdXQsXG4gICAgICAgIG1vZGVsLFxuICAgICAgICBuYW1lXG4gICAgICB9KVxuXG4gICAgICBzdG9yYWdlS2V5ID0gd3JpdGVSZXN1bHQuc3RvcmFnZUtleVxuXG4gICAgICAvLyBDdXJyZW50IHNjaGVtYXMga2VlcCBjb250ZW50X2Jhc2U2NCBudWxsYWJsZSBhbmQgYXZvaWQgZHVwbGljYXRpbmdcbiAgICAgIC8vIGRyaXZlci1iYWNrZWQgY29udGVudC4gTGVnYWN5IHBhdGggaW5wdXQgd2FzIG1hdGVyaWFsaXplZCBvbmNlIGJlZm9yZVxuICAgICAgLy8gdGhlIGRyaXZlciB3cml0ZSBzbyB0aGlzIHZhbHVlIGRlc2NyaWJlcyB0aG9zZSBleGFjdCBwZXJzaXN0ZWQgYnl0ZXMuXG4gICAgICBjb25zdCBkYXRhYmFzZUNvbnRlbnRCYXNlNjQgPSBhd2FpdCB0aGlzLmRhdGFiYXNlQ29udGVudEJhc2U2NEZvcihub3JtYWxpemVkSW5wdXQpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgICAgaWYgKHJlcGxhY2UpIHtcbiAgICAgICAgICBjb25zdCBleGlzdGluZ1Jvd3MgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAgICAgLndoZXJlKGF0dGFjaG1lbnRPd25lckNvbmRpdGlvbnMoe25hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSkpXG4gICAgICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGV4aXN0aW5nUm93IG9mIGV4aXN0aW5nUm93cykge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVBdHRhY2htZW50Um93U3RvcmFnZSh7bW9kZWwsIG5hbWUsIHJvdzogZXhpc3RpbmdSb3d9KVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICAgICAgICBjb25kaXRpb25zOiBhdHRhY2htZW50T3duZXJDb25kaXRpb25zKHtuYW1lLCByZWNvcmRJZCwgcmVjb3JkVHlwZX0pLFxuICAgICAgICAgICAgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwb3NpdGlvbiA9IHJlcGxhY2UgPyAwIDogYXdhaXQgdGhpcy5fbmV4dFBvc2l0aW9uKHtkYiwgbmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KVxuICAgICAgICAvKipcbiAgICAgICAgICogSW5zZXJ0IGRhdGEuXG4gICAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICAgIGNvbnN0IGluc2VydERhdGEgPSB7XG4gICAgICAgICAgYnl0ZV9zaXplOiBub3JtYWxpemVkSW5wdXQuYnl0ZVNpemUsXG4gICAgICAgICAgY29udGVudF9iYXNlNjQ6IGRhdGFiYXNlQ29udGVudEJhc2U2NCxcbiAgICAgICAgICBjb250ZW50X3R5cGU6IG5vcm1hbGl6ZWRJbnB1dC5jb250ZW50VHlwZSxcbiAgICAgICAgICBjcmVhdGVkX2F0X21zOiBub3csXG4gICAgICAgICAgZmlsZW5hbWU6IG5vcm1hbGl6ZWRJbnB1dC5maWxlbmFtZSxcbiAgICAgICAgICBpZDogYXR0YWNobWVudElkLFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgcG9zaXRpb24sXG4gICAgICAgICAgcmVjb3JkX2lkOiByZWNvcmRJZCxcbiAgICAgICAgICByZWNvcmRfaWRfZGlnZXN0OiBhdHRhY2htZW50UmVjb3JkSWREaWdlc3QocmVjb3JkSWQpLFxuICAgICAgICAgIHJlY29yZF90eXBlOiByZWNvcmRUeXBlLFxuICAgICAgICAgIHVwZGF0ZWRfYXRfbXM6IG5vd1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuX2RyaXZlckNvbHVtbnNBdmFpbGFibGUpIHtcbiAgICAgICAgICBpbnNlcnREYXRhLmRyaXZlciA9IGF0dGFjaG1lbnREcml2ZXJOYW1lXG4gICAgICAgICAgaW5zZXJ0RGF0YS5zdG9yYWdlX2tleSA9IHN0b3JhZ2VLZXlcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7XG4gICAgICAgICAgZGF0YTogaW5zZXJ0RGF0YSxcbiAgICAgICAgICB0YWJsZU5hbWU6IEFUVEFDSE1FTlRTX1RBQkxFXG4gICAgICAgIH0pXG5cbiAgICAgICAgcm93UGVyc2lzdGVkID0gdHJ1ZVxuICAgICAgfSwgbW9kZWwpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghcm93UGVyc2lzdGVkICYmIHN0b3JhZ2VLZXkgJiYgdHlwZW9mIGF0dGFjaG1lbnREcml2ZXIuZGVsZXRlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBhdHRhY2htZW50RHJpdmVyLmRlbGV0ZSh7XG4gICAgICAgICAgICBtb2RlbCxcbiAgICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgICByb3c6IHtpZDogYXR0YWNobWVudElkLCBzdG9yYWdlX2tleTogc3RvcmFnZUtleX0sXG4gICAgICAgICAgICBzdG9yYWdlS2V5XG4gICAgICAgICAgfSlcbiAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgW2Vycm9yLCBjbGVhbnVwRXJyb3JdLFxuICAgICAgICAgICAgYEF0dGFjaG1lbnQgd3JpdGUgZmluYWxpemF0aW9uIGFuZCBuZXctc3RvcmFnZSBjbGVhbnVwIGJvdGggZmFpbGVkIGZvciAke3JlY29yZFR5cGV9IyR7cmVjb3JkSWR9ICgke25hbWV9KWAsXG4gICAgICAgICAgICB7Y2F1c2U6IGNsZWFudXBFcnJvcn1cbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRhdGFiYXNlIGNvbnRlbnRfYmFzZTY0IHZhbHVlIGZvciBjdXJyZW50IGFuZCBsZWdhY3kgc2NoZW1hcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL25vcm1hbGl6ZS1pbnB1dC5qc1wiKS5Ob3JtYWxpemVkQXR0YWNobWVudElucHV0fSBub3JtYWxpemVkSW5wdXQgLSBOb3JtYWxpemVkIGF0dGFjaG1lbnQgaW5wdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIE51bGxhYmxlIG9yIGxlZ2FjeSBCYXNlNjQgZGF0YWJhc2UgdmFsdWUuXG4gICAqL1xuICBhc3luYyBkYXRhYmFzZUNvbnRlbnRCYXNlNjRGb3Iobm9ybWFsaXplZElucHV0KSB7XG4gICAgaWYgKHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSkgcmV0dXJuIG51bGxcbiAgICBpZiAobm9ybWFsaXplZElucHV0LmNvbnRlbnRCYXNlNjQgIT09IG51bGwpIHJldHVybiBub3JtYWxpemVkSW5wdXQuY29udGVudEJhc2U2NFxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTGVnYWN5IGF0dGFjaG1lbnQgc2NoZW1hIHJlcXVpcmVzIG1hdGVyaWFsaXplZCBjb250ZW50IGJ5dGVzXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgYXR0YWNobWVudCBzdG9yZSBzY2hlbWEuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERCIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2NoZW1hIGNvbHVtbnMgYXJlIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVBdHRhY2htZW50U3RvcmVTY2hlbWEoe2RifSkge1xuICAgIGlmICh0aGlzLl9zY2hlbWFSZWFkeUdlbmVyYXRpb24gPT09IHRoaXMuX3NjaGVtYUNhY2hlR2VuZXJhdGlvbihkYikpIHJldHVyblxuICAgIGlmICh0aGlzLl9zY2hlbWFVcGdyYWRlUHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuX3NjaGVtYVVwZ3JhZGVQcm9taXNlXG5cbiAgICB0aGlzLl9zY2hlbWFVcGdyYWRlUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2soQVRUQUNITUVOVF9TQ0hFTUFfTE9DS19OQU1FKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBhY3F1aXJlIGF0dGFjaG1lbnQgc2NoZW1hIGxvY2sgJHtBVFRBQ0hNRU5UX1NDSEVNQV9MT0NLX05BTUV9YClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKCFhd2FpdCBkYi50YWJsZUV4aXN0cyhBVFRBQ0hNRU5UU19UQUJMRSkpIHJldHVyblxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUF0dGFjaG1lbnRTdG9yZVNjaGVtYSh7ZGJ9KVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhBVFRBQ0hNRU5UX1NDSEVNQV9MT0NLX05BTUUpXG4gICAgICB9XG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3NjaGVtYVVwZ3JhZGVQcm9taXNlXG4gICAgICB0aGlzLl9zY2hlbWFSZWFkeUdlbmVyYXRpb24gPSB0aGlzLl9zY2hlbWFDYWNoZUdlbmVyYXRpb24oZGIpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3NjaGVtYVVwZ3JhZGVQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzY2hlbWEtY2FjaGUgZ2VuZXJhdGlvbiBmb3IgdGhlIGNvbm5lY3Rpb24ncyBwaHlzaWNhbCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEQiBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEN1cnJlbnQgc2NoZW1hLWNhY2hlIGdlbmVyYXRpb24uXG4gICAqL1xuICBfc2NoZW1hQ2FjaGVHZW5lcmF0aW9uKGRiKSB7XG4gICAgY29uc3QgcG9vbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2wodGhpcy5kYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgY29uc3QgcmV1c2VLZXkgPSBwb29sLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoZGIpXG5cbiAgICByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uLnNjaGVtYUNhY2hlR2VuZXJhdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYXR0YWNobWVudCBjb2x1bW5zIGFuZCBpbmRleGVzIGFmdGVyIHNjaGVtYS11cGdyYWRlIHNlcmlhbGl6YXRpb24gaXMgYWNxdWlyZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERCIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2NoZW1hIGNvbHVtbnMgYXJlIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQXR0YWNobWVudFN0b3JlU2NoZW1hKHtkYn0pIHtcbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgIGNvbnN0IGNvbHVtbnMgPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5zKClcbiAgICBjb25zdCBoYXNEcml2ZXJDb2x1bW4gPSBjb2x1bW5zLnNvbWUoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSA9PT0gXCJkcml2ZXJcIilcbiAgICBjb25zdCBoYXNTdG9yYWdlS2V5Q29sdW1uID0gY29sdW1ucy5zb21lKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT09IFwic3RvcmFnZV9rZXlcIilcbiAgICBjb25zdCBjb250ZW50QmFzZTY0Q29sdW1uID0gY29sdW1ucy5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT09IFwiY29udGVudF9iYXNlNjRcIilcbiAgICBjb25zdCByZWNvcmRJZENvbHVtbiA9IGNvbHVtbnMuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09PSBcInJlY29yZF9pZFwiKVxuICAgIGNvbnN0IHJlY29yZElkRGlnZXN0Q29sdW1uID0gY29sdW1ucy5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT09IFwicmVjb3JkX2lkX2RpZ2VzdFwiKVxuICAgIGNvbnN0IGFsdGVyVGFibGUgPSBuZXcgVGFibGVEYXRhKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgIGxldCBzaG91bGRBbHRlciA9IGZhbHNlXG5cbiAgICBpZiAoIXJlY29yZElkQ29sdW1uKSB0aHJvdyBuZXcgRXJyb3IoYCR7QVRUQUNITUVOVFNfVEFCTEV9LnJlY29yZF9pZCBpcyBtaXNzaW5nYClcblxuICAgIGNvbnN0IHJlY29yZElkTWF4TGVuZ3RoID0gcmVjb3JkSWRDb2x1bW4uZ2V0TWF4TGVuZ3RoKClcblxuICAgIGlmICh0eXBlb2YgcmVjb3JkSWRNYXhMZW5ndGggPT09IFwibnVtYmVyXCIgJiYgcmVjb3JkSWRNYXhMZW5ndGggPiAwKSB7XG4gICAgICBmb3IgKGNvbnN0IGluZGV4IG9mIGF3YWl0IHJlY29yZElkQ29sdW1uLmdldEluZGV4ZXMoKSkge1xuICAgICAgICBpZiAoaW5kZXguaXNQcmltYXJ5S2V5KCkpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgaW5kZXhOYW1lID0gaW5kZXguZ2V0TmFtZSgpXG5cbiAgICAgICAgaWYgKCFpbmRleE5hbWUpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYSBuYW1lIGZvciAke0FUVEFDSE1FTlRTX1RBQkxFfS5yZWNvcmRfaWQgaW5kZXhgKVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLnJlbW92ZUluZGV4U1FMcyh7bmFtZTogaW5kZXhOYW1lLCB0YWJsZU5hbWU6IEFUVEFDSE1FTlRTX1RBQkxFfSkpIHtcbiAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCByZWNvcmRJZEFsdGVyVGFibGUgPSBuZXcgVGFibGVEYXRhKEFUVEFDSE1FTlRTX1RBQkxFKVxuXG4gICAgICByZWNvcmRJZEFsdGVyVGFibGUudGV4dChcInJlY29yZF9pZFwiLCB7XG4gICAgICAgIGlzTmV3Q29sdW1uOiBmYWxzZSxcbiAgICAgICAgbnVsbDogZGIuZ2V0VHlwZSgpID09PSBcInBnc3FsXCIgPyB1bmRlZmluZWQgOiBmYWxzZVxuICAgICAgfSlcblxuICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHMocmVjb3JkSWRBbHRlclRhYmxlKSkge1xuICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH1cblxuICAgIGlmICghaGFzRHJpdmVyQ29sdW1uKSB7XG4gICAgICBhbHRlclRhYmxlLnN0cmluZyhcImRyaXZlclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICBzaG91bGRBbHRlciA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAoIWhhc1N0b3JhZ2VLZXlDb2x1bW4pIHtcbiAgICAgIGFsdGVyVGFibGUuc3RyaW5nKFwic3RvcmFnZV9rZXlcIiwge251bGw6IHRydWV9KVxuICAgICAgc2hvdWxkQWx0ZXIgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCFyZWNvcmRJZERpZ2VzdENvbHVtbikge1xuICAgICAgYWx0ZXJUYWJsZS5zdHJpbmcoXCJyZWNvcmRfaWRfZGlnZXN0XCIsIHttYXhMZW5ndGg6IEFUVEFDSE1FTlRfUkVDT1JEX0lEX0RJR0VTVF9MRU5HVEgsIG51bGw6IHRydWV9KVxuICAgICAgc2hvdWxkQWx0ZXIgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKHNob3VsZEFsdGVyKSB7XG4gICAgICBjb25zdCBhbHRlclRhYmxlU1FMcyA9IGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKGFsdGVyVGFibGUpXG5cbiAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGFsdGVyVGFibGVTUUxzKSB7XG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfVxuXG4gICAgaWYgKCFyZWNvcmRJZERpZ2VzdENvbHVtbiB8fCByZWNvcmRJZERpZ2VzdENvbHVtbi5nZXROdWxsKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuYmFja2ZpbGxBdHRhY2htZW50UmVjb3JkSWREaWdlc3RzKGRiKVxuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVBdHRhY2htZW50UmVjb3JkSWREaWdlc3ROb3ROdWxsKGRiKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlQXR0YWNobWVudE93bmVySW5kZXgoZGIpXG5cbiAgICB0aGlzLl9kcml2ZXJDb2x1bW5zQXZhaWxhYmxlID0gdHJ1ZVxuICAgIHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSA9IGNvbnRlbnRCYXNlNjRDb2x1bW4gPyBjb250ZW50QmFzZTY0Q29sdW1uLmdldE51bGwoKSA6IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBCYWNrZmlsbHMgYm91bmRlZCBhdHRhY2htZW50IG93bmVyIGRpZ2VzdHMgaW4gc21hbGwgYmF0Y2hlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IGV4aXN0aW5nIHJvdyBoYXMgYSBkaWdlc3QuXG4gICAqL1xuICBhc3luYyBiYWNrZmlsbEF0dGFjaG1lbnRSZWNvcmRJZERpZ2VzdHMoZGIpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3JlY29yZF9pZF9kaWdlc3Q6IG51bGx9KVxuICAgICAgICAubGltaXQoQVRUQUNITUVOVF9SRUNPUkRfSURfRElHRVNUX01JR1JBVElPTl9CQVRDSF9TSVpFKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgaWYgKHR5cGVvZiByb3cuaWQgIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHJvdy5yZWNvcmRfaWQgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGNhbm9uaWNhbCBhdHRhY2htZW50IGlkZW50aXR5IHN0cmluZ3Mgd2hpbGUgYmFja2ZpbGxpbmcgJHtBVFRBQ0hNRU5UU19UQUJMRX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgZGIudXBkYXRlKHtcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IHJvdy5pZH0sXG4gICAgICAgICAgZGF0YToge3JlY29yZF9pZF9kaWdlc3Q6IGF0dGFjaG1lbnRSZWNvcmRJZERpZ2VzdChyb3cucmVjb3JkX2lkKX0sXG4gICAgICAgICAgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBpZiAocm93cy5sZW5ndGggPCBBVFRBQ0hNRU5UX1JFQ09SRF9JRF9ESUdFU1RfTUlHUkFUSU9OX0JBVENIX1NJWkUpIHJldHVyblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNYWtlcyB0aGUgYmFja2ZpbGxlZCBhdHRhY2htZW50IG93bmVyIGRpZ2VzdCByZXF1aXJlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBkaWdlc3QgY29sdW1uIGlzIG5vbi1udWxsYWJsZS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUF0dGFjaG1lbnRSZWNvcmRJZERpZ2VzdE5vdE51bGwoZGIpIHtcbiAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgIGNvbnN0IHJlY29yZElkRGlnZXN0Q29sdW1uID0gYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lT3JGYWlsKFwicmVjb3JkX2lkX2RpZ2VzdFwiKVxuXG4gICAgaWYgKCFyZWNvcmRJZERpZ2VzdENvbHVtbi5nZXROdWxsKCkpIHJldHVyblxuXG4gICAgY29uc3QgYWx0ZXJUYWJsZSA9IG5ldyBUYWJsZURhdGEoQVRUQUNITUVOVFNfVEFCTEUpXG5cbiAgICBhbHRlclRhYmxlLnN0cmluZyhcInJlY29yZF9pZF9kaWdlc3RcIiwge1xuICAgICAgaXNOZXdDb2x1bW46IGZhbHNlLFxuICAgICAgbWF4TGVuZ3RoOiBBVFRBQ0hNRU5UX1JFQ09SRF9JRF9ESUdFU1RfTEVOR1RILFxuICAgICAgbnVsbDogZmFsc2VcbiAgICB9KVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHMoYWx0ZXJUYWJsZSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYXR0YWNobWVudCBvd25lciBxdWVyaWVzIHJldGFpbiBhIGJvdW5kZWQgY29tcG9zaXRlIGluZGV4LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIG93bmVyIGluZGV4IGV4aXN0cy5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUF0dGFjaG1lbnRPd25lckluZGV4KGRiKSB7XG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICBjb25zdCBpbmRleGVzID0gYXdhaXQgdGFibGUuZ2V0SW5kZXhlcygpXG4gICAgY29uc3Qgb3duZXJJbmRleCA9IGluZGV4ZXMuZmluZCgoaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGNvbHVtbk5hbWVzID0gaW5kZXguZ2V0Q29sdW1uTmFtZXMoKVxuXG4gICAgICByZXR1cm4gY29sdW1uTmFtZXMubGVuZ3RoID09PSAyICYmIGNvbHVtbk5hbWVzWzBdID09PSBcInJlY29yZF90eXBlXCIgJiYgY29sdW1uTmFtZXNbMV0gPT09IFwicmVjb3JkX2lkX2RpZ2VzdFwiXG4gICAgfSlcblxuICAgIGlmIChvd25lckluZGV4KSByZXR1cm5cblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmNyZWF0ZUluZGV4U1FMcyh7XG4gICAgICBjb2x1bW5zOiBbXCJyZWNvcmRfdHlwZVwiLCBcInJlY29yZF9pZF9kaWdlc3RcIl0sXG4gICAgICBpZk5vdEV4aXN0czogdHJ1ZSxcbiAgICAgIG5hbWU6IEFUVEFDSE1FTlRfT1dORVJfSU5ERVhfTkFNRSxcbiAgICAgIHRhYmxlTmFtZTogQVRUQUNITUVOVFNfVEFCTEVcbiAgICB9KSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkIGF0dGFjaG1lbnQgcm93LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5yb3cgLSBBdHRhY2htZW50IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QnVmZmVyPn0gLSBBdHRhY2htZW50IGJ5dGVzLlxuICAgKi9cbiAgYXN5bmMgcmVhZEF0dGFjaG1lbnRSb3coe21vZGVsLCBuYW1lLCByb3d9KSB7XG4gICAgaWYgKHR5cGVvZiByb3cuY29udGVudF9iYXNlNjQgPT09IFwic3RyaW5nXCIgJiYgcm93LmNvbnRlbnRfYmFzZTY0Lmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBCdWZmZXIuZnJvbShyb3cuY29udGVudF9iYXNlNjQsIFwiYmFzZTY0XCIpXG4gICAgfVxuXG4gICAgY29uc3Qgc3RvcmFnZUtleSA9IHR5cGVvZiByb3cuc3RvcmFnZV9rZXkgPT09IFwic3RyaW5nXCIgJiYgcm93LnN0b3JhZ2Vfa2V5Lmxlbmd0aCA+IDAgPyByb3cuc3RvcmFnZV9rZXkgOiBudWxsXG5cbiAgICBpZiAoIXN0b3JhZ2VLZXkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCByb3cgJHtTdHJpbmcocm93LmlkKX0gaXMgbWlzc2luZyBzdG9yYWdlIGtleWApXG4gICAgfVxuXG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lLCByb3d9KVxuXG4gICAgcmV0dXJuIGF3YWl0IGF0dGFjaG1lbnREcml2ZXIucmVhZCh7XG4gICAgICBtb2RlbCxcbiAgICAgIG5hbWUsXG4gICAgICByb3csXG4gICAgICBzdG9yYWdlS2V5XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgcm93IHVybC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mucm93IC0gQXR0YWNobWVudCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIEF0dGFjaG1lbnQgVVJMLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNobWVudFJvd1VybCh7bW9kZWwsIG5hbWUsIHJvd30pIHtcbiAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyID0gYXdhaXQgdGhpcy5yZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWUsIHJvd30pXG5cbiAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnREcml2ZXIudXJsICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzdG9yYWdlS2V5ID0gdHlwZW9mIHJvdy5zdG9yYWdlX2tleSA9PT0gXCJzdHJpbmdcIiAmJiByb3cuc3RvcmFnZV9rZXkubGVuZ3RoID4gMFxuICAgICAgPyByb3cuc3RvcmFnZV9rZXlcbiAgICAgIDogKHR5cGVvZiByb3cuaWQgPT09IFwic3RyaW5nXCIgPyByb3cuaWQgOiBcIlwiKVxuXG4gICAgaWYgKCFzdG9yYWdlS2V5KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGF3YWl0IGF0dGFjaG1lbnREcml2ZXIudXJsKHtcbiAgICAgIG1vZGVsLFxuICAgICAgbmFtZSxcbiAgICAgIHJvdyxcbiAgICAgIHN0b3JhZ2VLZXlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvbmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5pZF0gLSBPcHRpb25hbCBhdHRhY2htZW50IGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBBdHRhY2htZW50IHJvdy5cbiAgICovXG4gIGFzeW5jIGZpbmRPbmUoe2lkLCBtb2RlbCwgbmFtZX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KG1vZGVsKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZFR5cGUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICAgIGNvbnN0IHJlY29yZElkID0gYXR0YWNobWVudFJlY29yZElkKG1vZGVsKVxuICAgICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oQVRUQUNITUVOVFNfVEFCTEUpXG4gICAgICAgIC53aGVyZShhdHRhY2htZW50T3duZXJDb25kaXRpb25zKHtuYW1lLCByZWNvcmRJZCwgcmVjb3JkVHlwZX0pKVxuICAgICAgICAub3JkZXIoXCJwb3NpdGlvbiBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBERVNDXCIpXG4gICAgICAgIC5saW1pdCgxKVxuXG4gICAgICBpZiAoaWQpIHtcbiAgICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSh7aWR9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG5cbiAgICAgIHJldHVybiByb3dzWzBdIHx8IG51bGxcbiAgICB9LCBtb2RlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgbWFueS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IC0gQXR0YWNobWVudCByb3dzLlxuICAgKi9cbiAgYXN5bmMgZmluZE1hbnkoe21vZGVsLCBuYW1lfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkobW9kZWwpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkVHlwZSA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgICAgY29uc3QgcmVjb3JkSWQgPSBhdHRhY2htZW50UmVjb3JkSWQobW9kZWwpXG4gICAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoYXR0YWNobWVudE93bmVyQ29uZGl0aW9ucyh7bmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KSlcbiAgICAgICAgLm9yZGVyKFwicG9zaXRpb24gQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG5cbiAgICAgIHJldHVybiBhd2FpdCBxdWVyeS5yZXN1bHRzKClcbiAgICB9LCBtb2RlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVwYXJlcyBhdHRhY2htZW50IHNjaGVtYSBiZWZvcmUgYSByZWNvcmQgdHJhbnNhY3Rpb24gY2FuIG1pZ3JhdGUgb3duZXJzaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29ubmVjdGlvbiAtIFJlY29yZC1vd25pbmcgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBleGlzdGluZyBhdHRhY2htZW50IHNjaGVtYSBpcyBjdXJyZW50LlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZVJlY29yZElkZW50aXR5TWlncmF0aW9uKHtjb25uZWN0aW9ufSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlQXR0YWNobWVudFN0b3JlU2NoZW1hKHtkYjogY29ubmVjdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogTW92ZXMgZXZlcnkgYXR0YWNobWVudCByb3cgdG8gYSByZWNvcmQncyBuZXcgcHJpbWFyeS1rZXkgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5jb25uZWN0aW9uIC0gVHJhbnNhY3Rpb24tb3duaW5nIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIEF0dGFjaG1lbnQgb3duZXIgYWZ0ZXIgdGhlIGtleSBjaGFuZ2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGFyZ3MubmV4dElkZW50aXR5IC0gTmV3IG93bmVyIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBhcmdzLnByZXZpb3VzSWRlbnRpdHkgLSBQZXJzaXN0ZWQgb3duZXIgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIG93bmVyc2hpcCBpcyBtaWdyYXRlZC5cbiAgICovXG4gIGFzeW5jIG1pZ3JhdGVSZWNvcmRJZGVudGl0eSh7Y29ubmVjdGlvbiwgbW9kZWwsIG5leHRJZGVudGl0eSwgcHJldmlvdXNJZGVudGl0eX0pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IG5leHRSZWNvcmRJZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIG5leHRJZGVudGl0eSlcbiAgICBjb25zdCBwcmV2aW91c1JlY29yZElkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZGVudGl0eSlcblxuICAgIGlmIChuZXh0UmVjb3JkSWQgPT09IHByZXZpb3VzUmVjb3JkSWQpIHJldHVyblxuXG4gICAgaWYgKCFhd2FpdCBjb25uZWN0aW9uLnRhYmxlRXhpc3RzKEFUVEFDSE1FTlRTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBhd2FpdCBjb25uZWN0aW9uLnVwZGF0ZSh7XG4gICAgICBjb25kaXRpb25zOiBhdHRhY2htZW50T3duZXJDb25kaXRpb25zKHtcbiAgICAgICAgcmVjb3JkSWQ6IHByZXZpb3VzUmVjb3JkSWQsXG4gICAgICAgIHJlY29yZFR5cGU6IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgICAgfSksXG4gICAgICBkYXRhOiB7XG4gICAgICAgIHJlY29yZF9pZDogbmV4dFJlY29yZElkLFxuICAgICAgICByZWNvcmRfaWRfZGlnZXN0OiBhdHRhY2htZW50UmVjb3JkSWREaWdlc3QobmV4dFJlY29yZElkKVxuICAgICAgfSxcbiAgICAgIHRhYmxlTmFtZTogQVRUQUNITUVOVFNfVEFCTEVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsZXRlIGF0dGFjaG1lbnQgcm93IHN0b3JhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJvdyAtIEF0dGFjaG1lbnQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJvdyBzdG9yYWdlIGhhcyBiZWVuIGRlbGV0ZWQuXG4gICAqL1xuICBhc3luYyBkZWxldGVBdHRhY2htZW50Um93U3RvcmFnZSh7bW9kZWwsIG5hbWUsIHJvd30pIHtcbiAgICBjb25zdCBzdG9yYWdlS2V5ID0gdHlwZW9mIHJvdy5zdG9yYWdlX2tleSA9PT0gXCJzdHJpbmdcIiAmJiByb3cuc3RvcmFnZV9rZXkubGVuZ3RoID4gMCA/IHJvdy5zdG9yYWdlX2tleSA6IG51bGxcblxuICAgIGlmICghc3RvcmFnZUtleSkgcmV0dXJuXG5cbiAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyID0gYXdhaXQgdGhpcy5yZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWUsIHJvd30pXG5cbiAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnREcml2ZXIuZGVsZXRlICE9PSBcImZ1bmN0aW9uXCIpIHJldHVyblxuXG4gICAgYXdhaXQgYXR0YWNobWVudERyaXZlci5kZWxldGUoe1xuICAgICAgbW9kZWwsXG4gICAgICBuYW1lLFxuICAgICAgcm93LFxuICAgICAgc3RvcmFnZUtleVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUHVyZ2VzIGV2ZXJ5IGF0dGFjaG1lbnQgc3RvcmVkIHVuZGVyIChtb2RlbCwgbmFtZSk6IGRlbGV0ZXMgZWFjaCByb3cnc1xuICAgKiBiYWNraW5nIHN0b3JhZ2UgYW5kIHRoZW4gcmVtb3ZlcyB0aGUgYXR0YWNobWVudCByb3dzLiBVc2VkIHRvIGNsZWFuIHVwIGFuXG4gICAqIG93bmVyIHJlY29yZCdzIGF0dGFjaG1lbnRzIGJlZm9yZS93aGVuIHRoZSBvd25lciBpcyBkZXN0cm95ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIGF0dGFjaG1lbnRzIHB1cmdlZC5cbiAgICovXG4gIGFzeW5jIHB1cmdlQWxsKHttb2RlbCwgbmFtZX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KG1vZGVsKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZFR5cGUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICAgIGNvbnN0IHJlY29yZElkID0gYXR0YWNobWVudFJlY29yZElkKG1vZGVsKVxuICAgICAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoYXR0YWNobWVudE93bmVyQ29uZGl0aW9ucyh7bmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAvLyBSZWZ1c2UgdG8gcHVyZ2Ugd2hlbiBhbnkgcm93J3MgZHJpdmVyIGNhbm5vdCBkZWxldGUgaXRzIGJhY2tpbmcgc3RvcmFnZTpcbiAgICAgIC8vIHJlbW92aW5nIHRoZSByb3cgd2hpbGUgdGhlIG9iamVjdCBzdGF5cyBiZWhpbmQgd291bGQgbGVhayBzdG9yYWdlIGFuZFxuICAgICAgLy8gZGlzY2FyZCB0aGUgbWV0YWRhdGEgbmVlZGVkIHRvIHJldHJ5IGNsZWFudXAuIEZhaWwgbG91ZGx5IGluc3RlYWQuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IGF0dGFjaG1lbnREcml2ZXIgPSBhd2FpdCB0aGlzLnJlc29sdmVBdHRhY2htZW50RHJpdmVyKHttb2RlbCwgbmFtZSwgcm93fSlcblxuICAgICAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnREcml2ZXIuZGVsZXRlICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBwdXJnZSBhdHRhY2htZW50ICR7cm93LmlkfSBmb3IgJHtyZWNvcmRUeXBlfSMke3JlY29yZElkfSAoJHtuYW1lfSk6IGl0cyBzdG9yYWdlIGRyaXZlciBkb2VzIG5vdCBzdXBwb3J0IGRlbGV0aW9uLmApXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZUF0dGFjaG1lbnRSb3dTdG9yYWdlKHttb2RlbCwgbmFtZSwgcm93fSlcbiAgICAgICAgLy8gRGVsZXRlIG9ubHkgdGhlIHNuYXBzaG90dGVkIHJvdyBieSBpZCwgc28gYW4gYXR0YWNobWVudCBpbnNlcnRlZCBmb3IgdGhlXG4gICAgICAgIC8vIHNhbWUgKHJlY29yZCwgbmFtZSkgYWZ0ZXIgdGhlIHNuYXBzaG90IGlzIG5vdCByZW1vdmVkIHdpdGggaXRzIHN0b3JhZ2VcbiAgICAgICAgLy8gc3RpbGwgcHJlc2VudCAod2hpY2ggd291bGQgbGVhdmUgaXQgYXMgdW5yZWFjaGFibGUgc3RvcmFnZSkuXG4gICAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7Y29uZGl0aW9uczoge2lkOiByb3cuaWR9LCB0YWJsZU5hbWU6IEFUVEFDSE1FTlRTX1RBQkxFfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJvd3MubGVuZ3RoXG4gICAgfSwgbW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRyaXZlciBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZHJpdmVyTmFtZSAtIERyaXZlciBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgaW5zdGFuY2UuXG4gICAqL1xuICBhc3luYyBhdHRhY2htZW50RHJpdmVyQnlOYW1lKGRyaXZlck5hbWUpIHtcbiAgICBpZiAodGhpcy5fYXR0YWNobWVudERyaXZlcnNCeU5hbWUuaGFzKGRyaXZlck5hbWUpKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5TmFtZS5nZXQoZHJpdmVyTmFtZSkpXG4gICAgfVxuXG4gICAgY29uc3QgYXR0YWNobWVudENvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uPy4oKSB8fCB7fVxuICAgIGNvbnN0IGNvbmZpZ3VyZWREcml2ZXIgPSBhdHRhY2htZW50Q29uZmlndXJhdGlvbi5kcml2ZXJzPy5bZHJpdmVyTmFtZV1cbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGF0dGFjaG1lbnREcml2ZXIuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBsZXQgYXR0YWNobWVudERyaXZlclxuXG4gICAgaWYgKCFjb25maWd1cmVkRHJpdmVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbmZpZ3VyZWQgYXR0YWNobWVudCBzdG9yYWdlIGRyaXZlciBuYW1lZCBcIiR7ZHJpdmVyTmFtZX1cImApXG4gICAgfSBlbHNlIGlmIChjb25maWd1cmVkRHJpdmVyLmluc3RhbmNlICYmIHR5cGVvZiBjb25maWd1cmVkRHJpdmVyLmluc3RhbmNlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBhdHRhY2htZW50RHJpdmVyID0gY29uZmlndXJlZERyaXZlci5pbnN0YW5jZVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIuZHJpdmVyQ2xhc3MgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXR0YWNobWVudERyaXZlciA9IG5ldyBjb25maWd1cmVkRHJpdmVyLmRyaXZlckNsYXNzKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBuYW1lOiBkcml2ZXJOYW1lLFxuICAgICAgICBvcHRpb25zOiBjb25maWd1cmVkRHJpdmVyXG4gICAgICB9KVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIuY3JlYXRlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBjb25maWd1cmVkRHJpdmVyLmNyZWF0ZSh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgbmFtZTogZHJpdmVyTmFtZSxcbiAgICAgICAgb3B0aW9uczogY29uZmlndXJlZERyaXZlclxuICAgICAgfSlcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50IHN0b3JhZ2UgZHJpdmVyIFwiJHtkcml2ZXJOYW1lfVwiIG11c3QgZGVmaW5lIGluc3RhbmNlLCBkcml2ZXJDbGFzcywgb3IgY3JlYXRlYClcbiAgICB9XG5cbiAgICBpZiAoIWF0dGFjaG1lbnREcml2ZXIgfHwgdHlwZW9mIGF0dGFjaG1lbnREcml2ZXIud3JpdGUgIT09IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgYXR0YWNobWVudERyaXZlci5yZWFkICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCBzdG9yYWdlIGRyaXZlciBcIiR7ZHJpdmVyTmFtZX1cIiBtdXN0IGltcGxlbWVudCB3cml0ZS9yZWFkYClcbiAgICB9XG5cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5TmFtZS5zZXQoZHJpdmVyTmFtZSwgYXR0YWNobWVudERyaXZlcilcblxuICAgIHJldHVybiBhdHRhY2htZW50RHJpdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRyaXZlciBieSByZWZlcmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuZHJpdmVyUmVmZXJlbmNlIC0gRHJpdmVyIGNsYXNzIG9yIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQXR0YWNobWVudCBkcml2ZXIgaW5zdGFuY2UuXG4gICAqL1xuICBhdHRhY2htZW50RHJpdmVyQnlSZWZlcmVuY2Uoe2F0dGFjaG1lbnROYW1lLCBkcml2ZXJSZWZlcmVuY2UsIG1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlSZWZlcmVuY2UuaGFzKGRyaXZlclJlZmVyZW5jZSkpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlSZWZlcmVuY2UuZ2V0KGRyaXZlclJlZmVyZW5jZSkpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBhdHRhY2htZW50RHJpdmVyLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgbGV0IGF0dGFjaG1lbnREcml2ZXJcblxuICAgIGlmICh0eXBlb2YgZHJpdmVyUmVmZXJlbmNlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGNvbnN0IERyaXZlckNsYXNzID0gLyoqIEB0eXBlIHtBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3J9ICovIChkcml2ZXJSZWZlcmVuY2UpXG5cbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBuZXcgRHJpdmVyQ2xhc3Moe1xuICAgICAgICBhdHRhY2htZW50TmFtZSxcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBtb2RlbENsYXNzXG4gICAgICB9KVxuICAgIH0gZWxzZSBpZiAoZHJpdmVyUmVmZXJlbmNlICYmIHR5cGVvZiBkcml2ZXJSZWZlcmVuY2UgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBkcml2ZXJSZWZlcmVuY2VcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGF0dGFjaG1lbnQgZHJpdmVyIHJlZmVyZW5jZSBmb3IgJHttb2RlbENsYXNzLm5hbWV9IyR7YXR0YWNobWVudE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnREcml2ZXIud3JpdGUgIT09IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgYXR0YWNobWVudERyaXZlci5yZWFkICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCBkcml2ZXIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfSMke2F0dGFjaG1lbnROYW1lfSBtdXN0IGltcGxlbWVudCB3cml0ZS9yZWFkYClcbiAgICB9XG5cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5UmVmZXJlbmNlLnNldChkcml2ZXJSZWZlcmVuY2UsIGF0dGFjaG1lbnREcml2ZXIpXG5cbiAgICByZXR1cm4gYXR0YWNobWVudERyaXZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkcml2ZXIgbmFtZSBmb3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBkcml2ZXIgbmFtZS5cbiAgICovXG4gIF9hdHRhY2htZW50RHJpdmVyTmFtZUZvcih7bW9kZWwsIG5hbWV9KSB7XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0YWNobWVudEJ5TmFtZShuYW1lKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWREcml2ZXIgPSBhdHRhY2htZW50RGVmaW5pdGlvbi5kcml2ZXJcbiAgICBjb25zdCBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uPy4oKSB8fCB7fVxuICAgIGNvbnN0IGRlZmF1bHREcml2ZXIgPSBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24uZGVmYXVsdERyaXZlclxuXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkRHJpdmVyID09PSBcInN0cmluZ1wiICYmIGNvbmZpZ3VyZWREcml2ZXIubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGNvbmZpZ3VyZWREcml2ZXJcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIGNvbmZpZ3VyZWREcml2ZXIubmFtZSB8fCBcImN1c3RvbVwiXG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZ3VyZWREcml2ZXIgJiYgdHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGNvbnN0IGNvbnN0cnVjdG9yTmFtZSA9IGNvbmZpZ3VyZWREcml2ZXIuY29uc3RydWN0b3I/Lm5hbWVcblxuICAgICAgaWYgKHR5cGVvZiBjb25zdHJ1Y3Rvck5hbWUgPT09IFwic3RyaW5nXCIgJiYgY29uc3RydWN0b3JOYW1lLmxlbmd0aCA+IDAgJiYgY29uc3RydWN0b3JOYW1lICE9PSBcIk9iamVjdFwiKSB7XG4gICAgICAgIHJldHVybiBjb25zdHJ1Y3Rvck5hbWVcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIFwiY3VzdG9tXCJcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRlZmF1bHREcml2ZXIgPT09IFwic3RyaW5nXCIgJiYgZGVmYXVsdERyaXZlci5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gZGVmYXVsdERyaXZlclxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgTm8gYXR0YWNobWVudCBkcml2ZXIgY29uZmlndXJlZCBmb3IgJHttb2RlbC5nZXRNb2RlbENsYXNzKCkubmFtZX0jJHtuYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGF0dGFjaG1lbnQgZHJpdmVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3Mucm93XSAtIEF0dGFjaG1lbnQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgaW5zdGFuY2UuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWUsIHJvd30pIHtcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRhY2htZW50QnlOYW1lKG5hbWUpXG4gICAgY29uc3QgY29uZmlndXJlZERyaXZlciA9IGF0dGFjaG1lbnREZWZpbml0aW9uLmRyaXZlclxuICAgIGlmICh0eXBlb2YgY29uZmlndXJlZERyaXZlciA9PT0gXCJmdW5jdGlvblwiIHx8IChjb25maWd1cmVkRHJpdmVyICYmIHR5cGVvZiBjb25maWd1cmVkRHJpdmVyID09PSBcIm9iamVjdFwiKSkge1xuICAgICAgcmV0dXJuIHRoaXMuYXR0YWNobWVudERyaXZlckJ5UmVmZXJlbmNlKHtcbiAgICAgICAgYXR0YWNobWVudE5hbWU6IG5hbWUsXG4gICAgICAgIGRyaXZlclJlZmVyZW5jZTogY29uZmlndXJlZERyaXZlcixcbiAgICAgICAgbW9kZWxDbGFzczogbW9kZWwuZ2V0TW9kZWxDbGFzcygpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IGZhbGxiYWNrRHJpdmVyTmFtZSA9IHR5cGVvZiByb3c/LmRyaXZlciA9PT0gXCJzdHJpbmdcIiAmJiByb3cuZHJpdmVyLmxlbmd0aCA+IDBcbiAgICAgID8gcm93LmRyaXZlclxuICAgICAgOiB0aGlzLl9hdHRhY2htZW50RHJpdmVyTmFtZUZvcih7bW9kZWwsIG5hbWV9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuYXR0YWNobWVudERyaXZlckJ5TmFtZShmYWxsYmFja0RyaXZlck5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IHBvc2l0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEQiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWNvcmRJZCAtIFJlY29yZCBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVjb3JkVHlwZSAtIFJlY29yZCB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE5leHQgcG9zaXRpb24uXG4gICAqL1xuICBhc3luYyBfbmV4dFBvc2l0aW9uKHtkYiwgbmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KSB7XG4gICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgLndoZXJlKGF0dGFjaG1lbnRPd25lckNvbmRpdGlvbnMoe25hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSkpXG4gICAgICAub3JkZXIoXCJwb3NpdGlvbiBERVNDXCIpXG4gICAgICAubGltaXQoMSlcbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgY29uc3QgY3VycmVudFJvdyA9IC8qKiBAdHlwZSB7e3Bvc2l0aW9uPzogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gfCB1bmRlZmluZWR9ICovIChyb3dzWzBdKVxuICAgIGNvbnN0IGN1cnJlbnQgPSBOdW1iZXIoY3VycmVudFJvdz8ucG9zaXRpb24pXG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShjdXJyZW50KSkgcmV0dXJuIDBcblxuICAgIHJldHVybiBjdXJyZW50ICsgMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkYi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IFttb2RlbF0gLSBPcGVyYXRpb24tb3duaW5nIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aERiKGNhbGxiYWNrLCBtb2RlbCkge1xuICAgIGlmIChtb2RlbCAmJiBtb2RlbC5kYXRhYmFzZU9wZXJhdGlvbigpKSByZXR1cm4gYXdhaXQgY2FsbGJhY2sobW9kZWwuY29ubmVjdGlvbigpKVxuXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2wodGhpcy5kYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyByZXN1bHQuXG4gICAgICogQHR5cGUge1QgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHJlc3VsdFxuXG4gICAgYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJSZWNvcmQgYXR0YWNobWVudCBzdG9yZVwifSwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXN1bHQgPSBhd2FpdCBjYWxsYmFjayhkYilcbiAgICB9KVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHJlc3VsdClcbiAgfVxufVxuIl19