// @ts-check
import { createHash } from "node:crypto";
import UUID from "pure-uuid";
import TableData from "../../table-data/index.js";
import TableIndex from "../../table-data/table-index.js";
import { modelPrimaryKeyCacheKey } from "../../../utils/model-primary-key.js";
import normalizeRecordAttachmentInput from "./normalize-input.js";
/**
 * AttachmentDriverConstructor type.
 * @typedef {import("../../../configuration-types.js").AttachmentDriverConstructor} AttachmentDriverConstructor */
const ATTACHMENTS_TABLE = "velocious_attachments";
const ATTACHMENT_OWNER_INDEX_NAME = "index_velocious_attachments_on_record_type_and_record_id_digest";
const ATTACHMENT_RECORD_ID_DIGEST_LENGTH = 64;
const ATTACHMENT_RECORD_ID_DIGEST_MIGRATION_BATCH_SIZE = 100;
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
    return createHash("sha256").update(recordId).digest("hex");
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
 * Runs the recordAttachmentsStoreForModel helper.
 * @param {import("../index.js").default} model - Model instance.
 * @returns {RecordAttachmentsStore} - Store instance.
 */
export function recordAttachmentsStoreForModel(model) {
    const configuration = model._getConfiguration();
    let storesByDatabaseIdentifier = storesByConfiguration.get(configuration);
    if (!storesByDatabaseIdentifier) {
        storesByDatabaseIdentifier = new Map();
        storesByConfiguration.set(configuration, storesByDatabaseIdentifier);
    }
    const key = storeKeyForModel(model);
    let store = storesByDatabaseIdentifier.get(key);
    if (store)
        return store;
    store = new RecordAttachmentsStore({
        configuration,
        databaseIdentifier: model.databaseOperation()?.databaseIdentifier() || model.getModelClass().getDatabaseIdentifier()
    });
    storesByDatabaseIdentifier.set(key, store);
    return store;
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
        db.clearSchemaCache();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F0dGFjaG1lbnRzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sYUFBYSxDQUFBO0FBQ3RDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLFNBQVMsTUFBTSwyQkFBMkIsQ0FBQTtBQUNqRCxPQUFPLFVBQVUsTUFBTSxpQ0FBaUMsQ0FBQTtBQUN4RCxPQUFPLEVBQUMsdUJBQXVCLEVBQUMsTUFBTSxxQ0FBcUMsQ0FBQTtBQUMzRSxPQUFPLDhCQUE4QixNQUFNLHNCQUFzQixDQUFBO0FBRWpFOztrSEFFa0g7QUFDbEgsTUFBTSxpQkFBaUIsR0FBRyx1QkFBdUIsQ0FBQTtBQUNqRCxNQUFNLDJCQUEyQixHQUFHLGlFQUFpRSxDQUFBO0FBQ3JHLE1BQU0sa0NBQWtDLEdBQUcsRUFBRSxDQUFBO0FBQzdDLE1BQU0sZ0RBQWdELEdBQUcsR0FBRyxDQUFBO0FBRTVEOzt1R0FFdUc7QUFDdkcsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBRTNDOzs7R0FHRztBQUNILFNBQVMsWUFBWTtJQUNuQixPQUFPLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFBO0FBQzdCLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxLQUFLO0lBQy9CLE9BQU8sdUJBQXVCLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFDLFVBQVUsRUFBRSxFQUFFLEtBQUssQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFBO0FBQ2hGLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyx3QkFBd0IsQ0FBQyxRQUFRO0lBQ3hDLE9BQU8sVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxR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QU1HO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsS0FBSztRQUMzQixJQUFJLEtBQUssSUFBSSxLQUFLLENBQUMsaUJBQWlCLEVBQUU7WUFBRSxPQUFPLE1BQU0sUUFBUSxDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFBO1FBRWpGLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBQ3hFOzttQ0FFMkI7UUFDM0IsSUFBSSxNQUFNLENBQUE7UUFFVixNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxJQUFJLEVBQUUseUJBQXlCLEVBQUMsRUFBRSxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDeEUsTUFBTSxHQUFHLE1BQU0sUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzdCLENBQUMsQ0FBQyxDQUFBO1FBRUYsT0FBTyxnQkFBZ0IsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ2xDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2NyZWF0ZUhhc2h9IGZyb20gXCJub2RlOmNyeXB0b1wiXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlSW5kZXggZnJvbSBcIi4uLy4uL3RhYmxlLWRhdGEvdGFibGUtaW5kZXguanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDYWNoZUtleX0gZnJvbSBcIi4uLy4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCBub3JtYWxpemVSZWNvcmRBdHRhY2htZW50SW5wdXQgZnJvbSBcIi4vbm9ybWFsaXplLWlucHV0LmpzXCJcblxuLyoqXG4gKiBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3Rvcn0gQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yICovXG5jb25zdCBBVFRBQ0hNRU5UU19UQUJMRSA9IFwidmVsb2Npb3VzX2F0dGFjaG1lbnRzXCJcbmNvbnN0IEFUVEFDSE1FTlRfT1dORVJfSU5ERVhfTkFNRSA9IFwiaW5kZXhfdmVsb2Npb3VzX2F0dGFjaG1lbnRzX29uX3JlY29yZF90eXBlX2FuZF9yZWNvcmRfaWRfZGlnZXN0XCJcbmNvbnN0IEFUVEFDSE1FTlRfUkVDT1JEX0lEX0RJR0VTVF9MRU5HVEggPSA2NFxuY29uc3QgQVRUQUNITUVOVF9SRUNPUkRfSURfRElHRVNUX01JR1JBVElPTl9CQVRDSF9TSVpFID0gMTAwXG5cbi8qKlxuICogU3RvcmVzIGJ5IGNvbmZpZ3VyYXRpb24uXG4gKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi8uLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRzU3RvcmU+Pn0gKi9cbmNvbnN0IHN0b3Jlc0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBSdW5zIGdlbmVyYXRlIHV1aWQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEdlbmVyYXRlZCBVVUlEIHY0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVVVSUQoKSB7XG4gIHJldHVybiBuZXcgVVVJRCg0KS5mb3JtYXQoKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNhbm9uaWNhbCBzdG9yZWQgb3duZXIgaWRlbnRpdHkgZm9yIGEgbW9kZWwgYXR0YWNobWVudC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBBdHRhY2htZW50IG93bmVyLlxuICogQHJldHVybnMge3N0cmluZ30gLSBDYW5vbmljYWwgb3duZXIgaWRlbnRpdHkuXG4gKi9cbmZ1bmN0aW9uIGF0dGFjaG1lbnRSZWNvcmRJZChtb2RlbCkge1xuICByZXR1cm4gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkobW9kZWwuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKSwgbW9kZWwuaWQoKSlcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgYm91bmRlZCBkaWdlc3QgZm9yIGluZGV4ZWQgYXR0YWNobWVudCBvd25lciBsb29rdXBzLlxuICogQHBhcmFtIHtzdHJpbmd9IHJlY29yZElkIC0gQ2Fub25pY2FsIGF0dGFjaG1lbnQgb3duZXIgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNIQS0yNTYgZGlnZXN0LlxuICovXG5mdW5jdGlvbiBhdHRhY2htZW50UmVjb3JkSWREaWdlc3QocmVjb3JkSWQpIHtcbiAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKHJlY29yZElkKS5kaWdlc3QoXCJoZXhcIilcbn1cblxuLyoqXG4gKiBCdWlsZHMgY29sbGlzaW9uLXNhZmUgYXR0YWNobWVudCBvd25lciBsb29rdXAgY29uZGl0aW9ucy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3duZXIgbG9va3VwIHZhbHVlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5uYW1lXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlY29yZElkIC0gQ2Fub25pY2FsIG93bmVyIGlkZW50aXR5LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVjb3JkVHlwZSAtIE93bmVyIG1vZGVsIG5hbWUuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBJbmRleGVkIGRpZ2VzdCBhbmQgY2Fub25pY2FsIGlkZW50aXR5IGNvbmRpdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIGF0dGFjaG1lbnRPd25lckNvbmRpdGlvbnMoe25hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSkge1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gIGNvbnN0IGNvbmRpdGlvbnMgPSB7XG4gICAgcmVjb3JkX2lkOiByZWNvcmRJZCxcbiAgICByZWNvcmRfaWRfZGlnZXN0OiBhdHRhY2htZW50UmVjb3JkSWREaWdlc3QocmVjb3JkSWQpLFxuICAgIHJlY29yZF90eXBlOiByZWNvcmRUeXBlXG4gIH1cblxuICBpZiAobmFtZSAhPT0gdW5kZWZpbmVkKSBjb25kaXRpb25zLm5hbWUgPSBuYW1lXG5cbiAgcmV0dXJuIGNvbmRpdGlvbnNcbn1cblxuLyoqXG4gKiBSdW5zIHN0b3JlIGtleSBmb3IgbW9kZWwuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFN0b3JlIGtleS5cbiAqL1xuZnVuY3Rpb24gc3RvcmVLZXlGb3JNb2RlbChtb2RlbCkge1xuICBjb25zdCBvcGVyYXRpb24gPSBtb2RlbC5kYXRhYmFzZU9wZXJhdGlvbigpXG5cbiAgaWYgKG9wZXJhdGlvbikgcmV0dXJuIG9wZXJhdGlvbi5kYXRhYmFzZUlkZW50aXR5KClcblxuICByZXR1cm4gYCR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldERhdGFiYXNlSWRlbnRpZmllcigpfWBcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSByZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWwgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICogQHJldHVybnMge1JlY29yZEF0dGFjaG1lbnRzU3RvcmV9IC0gU3RvcmUgaW5zdGFuY2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWwobW9kZWwpIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKClcbiAgbGV0IHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyID0gc3RvcmVzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gIGlmICghc3RvcmVzQnlEYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICBzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllciA9IG5ldyBNYXAoKVxuICAgIHN0b3Jlc0J5Q29uZmlndXJhdGlvbi5zZXQoY29uZmlndXJhdGlvbiwgc3RvcmVzQnlEYXRhYmFzZUlkZW50aWZpZXIpXG4gIH1cblxuICBjb25zdCBrZXkgPSBzdG9yZUtleUZvck1vZGVsKG1vZGVsKVxuICBsZXQgc3RvcmUgPSBzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllci5nZXQoa2V5KVxuXG4gIGlmIChzdG9yZSkgcmV0dXJuIHN0b3JlXG5cbiAgc3RvcmUgPSBuZXcgUmVjb3JkQXR0YWNobWVudHNTdG9yZSh7XG4gICAgY29uZmlndXJhdGlvbixcbiAgICBkYXRhYmFzZUlkZW50aWZpZXI6IG1vZGVsLmRhdGFiYXNlT3BlcmF0aW9uKCk/LmRhdGFiYXNlSWRlbnRpZmllcigpIHx8IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICB9KVxuXG4gIHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyLnNldChrZXksIHN0b3JlKVxuXG4gIHJldHVybiBzdG9yZVxufVxuXG4vKipcbiAqIEF0dGFjaG1lbnQgcGVyc2lzdGVuY2Ugc3RvcmUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFJlY29yZEF0dGFjaG1lbnRzU3RvcmUge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGF0YWJhc2VJZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXJ9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX2RyaXZlckNvbHVtbnNBdmFpbGFibGUgPSBmYWxzZVxuICAgIHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSA9IHRydWVcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgdGhpcy5fYXR0YWNobWVudERyaXZlcnNCeU5hbWUgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge01hcDxBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgdGhpcy5fYXR0YWNobWVudERyaXZlcnNCeVJlZmVyZW5jZSA9IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHJlYWR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IFttb2RlbF0gLSBPcGVyYXRpb24tb3duaW5nIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNjaGVtYSBpcyByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVJlYWR5KG1vZGVsKSB7XG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmVuc3VyZVNjaGVtYShkYilcbiAgICAgIH0sIG1vZGVsKVxuICAgIH0pKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGF0dGFjaG1lbnQgc2NoZW1hIHRocm91Z2ggYW4gYWxyZWFkeS1vd25lZCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2NoZW1hIGlzIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlU2NoZW1hKGRiKSB7XG4gICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG5cbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoQVRUQUNITUVOVFNfVEFCTEUpKSB7XG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZUF0dGFjaG1lbnRTdG9yZVNjaGVtYSh7ZGJ9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKEFUVEFDSE1FTlRTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwiaWRcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJyZWNvcmRfdHlwZVwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwicmVjb3JkX2lkXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwicmVjb3JkX2lkX2RpZ2VzdFwiLCB7bWF4TGVuZ3RoOiBBVFRBQ0hNRU5UX1JFQ09SRF9JRF9ESUdFU1RfTEVOR1RILCBudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwibmFtZVwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwicG9zaXRpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJmaWxlbmFtZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImNvbnRlbnRfdHlwZVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiYnl0ZV9zaXplXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiZHJpdmVyXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzdG9yYWdlX2tleVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImNvbnRlbnRfYmFzZTY0XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwidXBkYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInJlY29yZF90eXBlXCIsIFwicmVjb3JkX2lkX2RpZ2VzdFwiXSwge25hbWU6IEFUVEFDSE1FTlRfT1dORVJfSU5ERVhfTkFNRX0pKVxuXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgdGhpcy5fZHJpdmVyQ29sdW1uc0F2YWlsYWJsZSA9IHRydWVcbiAgICB0aGlzLl9jb250ZW50QmFzZTY0TnVsbGFibGUgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2guXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucmVwbGFjZSAtIFdoZXRoZXIgdG8gcmVwbGFjZSBleGlzdGluZyBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGF0dGFjaCh7aW5wdXQsIG1vZGVsLCBuYW1lLCByZXBsYWNlfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkobW9kZWwpXG4gICAgY29uc3QgYXR0YWNobWVudHNDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbj8uKCkgfHwge31cbiAgICBjb25zdCBhbGxvd1BhdGhJbnB1dCA9IGF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbi5hbGxvd1BhdGhJbnB1dCA9PT0gdHJ1ZVxuICAgIGNvbnN0IGFsbG93ZWRQYXRoUHJlZml4ZXMgPSBBcnJheS5pc0FycmF5KGF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbi5hbGxvd2VkUGF0aFByZWZpeGVzKVxuICAgICAgPyBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24uYWxsb3dlZFBhdGhQcmVmaXhlc1xuICAgICAgOiB1bmRlZmluZWRcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRJbnB1dCA9IGF3YWl0IG5vcm1hbGl6ZVJlY29yZEF0dGFjaG1lbnRJbnB1dChpbnB1dCwge1xuICAgICAgYWxsb3dQYXRoSW5wdXQsXG4gICAgICBhbGxvd2VkUGF0aFByZWZpeGVzLFxuICAgICAgZW52aXJvbm1lbnRIYW5kbGVyOiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICB9KVxuICAgIC8qKlxuICAgICAqIEF0dGFjaG1lbnQgcGVyc2lzdGVuY2UgZXJyb3IuXG4gICAgICogVGhpcyBzdGF5cyBvcGFxdWUgc28gYW55IEphdmFTY3JpcHQgdGhyb3duIHZhbHVlIGlzIHByZXNlcnZlZCBleGFjdGx5LlxuICAgICAqIEB0eXBlIHt1bmtub3dufSAqL1xuICAgIGxldCBwZXJzaXN0ZW5jZUVycm9yID0gbnVsbFxuICAgIGxldCBwZXJzaXN0ZW5jZUZhaWxlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcGVyc2lzdGVuY2VJbnB1dCA9IGF3YWl0IHRoaXMucGVyc2lzdGVuY2VJbnB1dEZvcihub3JtYWxpemVkSW5wdXQpXG5cbiAgICAgIGF3YWl0IHRoaXMucGVyc2lzdE5vcm1hbGl6ZWRBdHRhY2htZW50KHtcbiAgICAgICAgbW9kZWwsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIG5vcm1hbGl6ZWRJbnB1dDogcGVyc2lzdGVuY2VJbnB1dCxcbiAgICAgICAgcmVwbGFjZVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcGVyc2lzdGVuY2VGYWlsZWQgPSB0cnVlXG4gICAgICBwZXJzaXN0ZW5jZUVycm9yID0gZXJyb3JcbiAgICB9XG5cbiAgICBpZiAobm9ybWFsaXplZElucHV0LnBhdGhTb3VyY2UpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG5vcm1hbGl6ZWRJbnB1dC5wYXRoU291cmNlLmNsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgaWYgKHBlcnNpc3RlbmNlRmFpbGVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgW3BlcnNpc3RlbmNlRXJyb3IsIGNsb3NlRXJyb3JdLFxuICAgICAgICAgICAgYEF0dGFjaG1lbnQgcGVyc2lzdGVuY2UgYW5kIHBhdGgtc291cmNlIGNsb3NlIGJvdGggZmFpbGVkIGZvciAke21vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKX0jJHthdHRhY2htZW50UmVjb3JkSWQobW9kZWwpfSAoJHtuYW1lfSlgLFxuICAgICAgICAgICAge2NhdXNlOiBjbG9zZUVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IGNsb3NlRXJyb3JcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocGVyc2lzdGVuY2VGYWlsZWQpIHRocm93IHBlcnNpc3RlbmNlRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXRlcmlhbGl6ZXMgcGF0aCBjb250ZW50IG9uY2Ugd2hlbiBhIGxlZ2FjeSBzY2hlbWEgcmVxdWlyZXMgQmFzZTY0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbm9ybWFsaXplLWlucHV0LmpzXCIpLk5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXR9IG5vcm1hbGl6ZWRJbnB1dCAtIE5vcm1hbGl6ZWQgYXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dD59IC0gSW5wdXQgdXNlZCBieSB0aGUgZHJpdmVyIGFuZCBkYXRhYmFzZS5cbiAgICovXG4gIGFzeW5jIHBlcnNpc3RlbmNlSW5wdXRGb3Iobm9ybWFsaXplZElucHV0KSB7XG4gICAgaWYgKHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSB8fCAhbm9ybWFsaXplZElucHV0LnBhdGhTb3VyY2UpIHJldHVybiBub3JtYWxpemVkSW5wdXRcblxuICAgIGNvbnN0IGNvbnRlbnRCdWZmZXIgPSBhd2FpdCBub3JtYWxpemVkSW5wdXQucGF0aFNvdXJjZS5yZWFkQnVmZmVyKClcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5ub3JtYWxpemVkSW5wdXQsXG4gICAgICBjb250ZW50QmFzZTY0OiBjb250ZW50QnVmZmVyLnRvU3RyaW5nKFwiYmFzZTY0XCIpLFxuICAgICAgY29udGVudEJ1ZmZlcixcbiAgICAgIHBhdGhTb3VyY2U6IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgb25lIG5vcm1hbGl6ZWQgYXR0YWNobWVudCB3aGlsZSBpdHMgcGF0aCBzb3VyY2UgcmVtYWlucyBvcGVuLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbm9ybWFsaXplLWlucHV0LmpzXCIpLk5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXR9IGFyZ3Mubm9ybWFsaXplZElucHV0IC0gTm9ybWFsaXplZCBhdHRhY2htZW50LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucmVwbGFjZSAtIFdoZXRoZXIgdG8gcmVwbGFjZSBleGlzdGluZyBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBwZXJzaXN0Tm9ybWFsaXplZEF0dGFjaG1lbnQoe21vZGVsLCBuYW1lLCBub3JtYWxpemVkSW5wdXQsIHJlcGxhY2V9KSB7XG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lfSlcbiAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyTmFtZSA9IHRoaXMuX2F0dGFjaG1lbnREcml2ZXJOYW1lRm9yKHttb2RlbCwgbmFtZX0pXG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IHJlY29yZFR5cGUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICBjb25zdCByZWNvcmRJZCA9IGF0dGFjaG1lbnRSZWNvcmRJZChtb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50SWQgPSBnZW5lcmF0ZVVVSUQoKVxuICAgIC8qKlxuICAgICAqIFdyaXR0ZW4gc3RvcmFnZSBrZXkuXG4gICAgICogQHR5cGUge3N0cmluZyB8IG51bGx9ICovXG4gICAgbGV0IHN0b3JhZ2VLZXkgPSBudWxsXG4gICAgbGV0IHJvd1BlcnNpc3RlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgd3JpdGVSZXN1bHQgPSBhd2FpdCBhdHRhY2htZW50RHJpdmVyLndyaXRlKHtcbiAgICAgICAgYXR0YWNobWVudElkLFxuICAgICAgICBpbnB1dDogbm9ybWFsaXplZElucHV0LFxuICAgICAgICBtb2RlbCxcbiAgICAgICAgbmFtZVxuICAgICAgfSlcblxuICAgICAgc3RvcmFnZUtleSA9IHdyaXRlUmVzdWx0LnN0b3JhZ2VLZXlcblxuICAgICAgLy8gQ3VycmVudCBzY2hlbWFzIGtlZXAgY29udGVudF9iYXNlNjQgbnVsbGFibGUgYW5kIGF2b2lkIGR1cGxpY2F0aW5nXG4gICAgICAvLyBkcml2ZXItYmFja2VkIGNvbnRlbnQuIExlZ2FjeSBwYXRoIGlucHV0IHdhcyBtYXRlcmlhbGl6ZWQgb25jZSBiZWZvcmVcbiAgICAgIC8vIHRoZSBkcml2ZXIgd3JpdGUgc28gdGhpcyB2YWx1ZSBkZXNjcmliZXMgdGhvc2UgZXhhY3QgcGVyc2lzdGVkIGJ5dGVzLlxuICAgICAgY29uc3QgZGF0YWJhc2VDb250ZW50QmFzZTY0ID0gYXdhaXQgdGhpcy5kYXRhYmFzZUNvbnRlbnRCYXNlNjRGb3Iobm9ybWFsaXplZElucHV0KVxuXG4gICAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGlmIChyZXBsYWNlKSB7XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmdSb3dzID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgICAgICAgIC53aGVyZShhdHRhY2htZW50T3duZXJDb25kaXRpb25zKHtuYW1lLCByZWNvcmRJZCwgcmVjb3JkVHlwZX0pKVxuICAgICAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAgICAgZm9yIChjb25zdCBleGlzdGluZ1JvdyBvZiBleGlzdGluZ1Jvd3MpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZGVsZXRlQXR0YWNobWVudFJvd1N0b3JhZ2Uoe21vZGVsLCBuYW1lLCByb3c6IGV4aXN0aW5nUm93fSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgICAgICAgY29uZGl0aW9uczogYXR0YWNobWVudE93bmVyQ29uZGl0aW9ucyh7bmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KSxcbiAgICAgICAgICAgIHRhYmxlTmFtZTogQVRUQUNITUVOVFNfVEFCTEVcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcG9zaXRpb24gPSByZXBsYWNlID8gMCA6IGF3YWl0IHRoaXMuX25leHRQb3NpdGlvbih7ZGIsIG5hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSlcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEluc2VydCBkYXRhLlxuICAgICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgICBjb25zdCBpbnNlcnREYXRhID0ge1xuICAgICAgICAgIGJ5dGVfc2l6ZTogbm9ybWFsaXplZElucHV0LmJ5dGVTaXplLFxuICAgICAgICAgIGNvbnRlbnRfYmFzZTY0OiBkYXRhYmFzZUNvbnRlbnRCYXNlNjQsXG4gICAgICAgICAgY29udGVudF90eXBlOiBub3JtYWxpemVkSW5wdXQuY29udGVudFR5cGUsXG4gICAgICAgICAgY3JlYXRlZF9hdF9tczogbm93LFxuICAgICAgICAgIGZpbGVuYW1lOiBub3JtYWxpemVkSW5wdXQuZmlsZW5hbWUsXG4gICAgICAgICAgaWQ6IGF0dGFjaG1lbnRJZCxcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIHBvc2l0aW9uLFxuICAgICAgICAgIHJlY29yZF9pZDogcmVjb3JkSWQsXG4gICAgICAgICAgcmVjb3JkX2lkX2RpZ2VzdDogYXR0YWNobWVudFJlY29yZElkRGlnZXN0KHJlY29yZElkKSxcbiAgICAgICAgICByZWNvcmRfdHlwZTogcmVjb3JkVHlwZSxcbiAgICAgICAgICB1cGRhdGVkX2F0X21zOiBub3dcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLl9kcml2ZXJDb2x1bW5zQXZhaWxhYmxlKSB7XG4gICAgICAgICAgaW5zZXJ0RGF0YS5kcml2ZXIgPSBhdHRhY2htZW50RHJpdmVyTmFtZVxuICAgICAgICAgIGluc2VydERhdGEuc3RvcmFnZV9rZXkgPSBzdG9yYWdlS2V5XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgICAgIGRhdGE6IGluc2VydERhdGEsXG4gICAgICAgICAgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRVxuICAgICAgICB9KVxuXG4gICAgICAgIHJvd1BlcnNpc3RlZCA9IHRydWVcbiAgICAgIH0sIG1vZGVsKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIXJvd1BlcnNpc3RlZCAmJiBzdG9yYWdlS2V5ICYmIHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLmRlbGV0ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgYXR0YWNobWVudERyaXZlci5kZWxldGUoe1xuICAgICAgICAgICAgbW9kZWwsXG4gICAgICAgICAgICBuYW1lLFxuICAgICAgICAgICAgcm93OiB7aWQ6IGF0dGFjaG1lbnRJZCwgc3RvcmFnZV9rZXk6IHN0b3JhZ2VLZXl9LFxuICAgICAgICAgICAgc3RvcmFnZUtleVxuICAgICAgICAgIH0pXG4gICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xuICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtlcnJvciwgY2xlYW51cEVycm9yXSxcbiAgICAgICAgICAgIGBBdHRhY2htZW50IHdyaXRlIGZpbmFsaXphdGlvbiBhbmQgbmV3LXN0b3JhZ2UgY2xlYW51cCBib3RoIGZhaWxlZCBmb3IgJHtyZWNvcmRUeXBlfSMke3JlY29yZElkfSAoJHtuYW1lfSlgLFxuICAgICAgICAgICAge2NhdXNlOiBjbGVhbnVwRXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBkYXRhYmFzZSBjb250ZW50X2Jhc2U2NCB2YWx1ZSBmb3IgY3VycmVudCBhbmQgbGVnYWN5IHNjaGVtYXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dH0gbm9ybWFsaXplZElucHV0IC0gTm9ybWFsaXplZCBhdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBOdWxsYWJsZSBvciBsZWdhY3kgQmFzZTY0IGRhdGFiYXNlIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgZGF0YWJhc2VDb250ZW50QmFzZTY0Rm9yKG5vcm1hbGl6ZWRJbnB1dCkge1xuICAgIGlmICh0aGlzLl9jb250ZW50QmFzZTY0TnVsbGFibGUpIHJldHVybiBudWxsXG4gICAgaWYgKG5vcm1hbGl6ZWRJbnB1dC5jb250ZW50QmFzZTY0ICE9PSBudWxsKSByZXR1cm4gbm9ybWFsaXplZElucHV0LmNvbnRlbnRCYXNlNjRcblxuICAgIHRocm93IG5ldyBFcnJvcihcIkxlZ2FjeSBhdHRhY2htZW50IHNjaGVtYSByZXF1aXJlcyBtYXRlcmlhbGl6ZWQgY29udGVudCBieXRlc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGF0dGFjaG1lbnQgc3RvcmUgc2NoZW1hLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEQiBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNjaGVtYSBjb2x1bW5zIGFyZSBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQXR0YWNobWVudFN0b3JlU2NoZW1hKHtkYn0pIHtcbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgIGNvbnN0IGNvbHVtbnMgPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5zKClcbiAgICBjb25zdCBoYXNEcml2ZXJDb2x1bW4gPSBjb2x1bW5zLnNvbWUoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSA9PT0gXCJkcml2ZXJcIilcbiAgICBjb25zdCBoYXNTdG9yYWdlS2V5Q29sdW1uID0gY29sdW1ucy5zb21lKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT09IFwic3RvcmFnZV9rZXlcIilcbiAgICBjb25zdCBjb250ZW50QmFzZTY0Q29sdW1uID0gY29sdW1ucy5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT09IFwiY29udGVudF9iYXNlNjRcIilcbiAgICBjb25zdCByZWNvcmRJZENvbHVtbiA9IGNvbHVtbnMuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09PSBcInJlY29yZF9pZFwiKVxuICAgIGNvbnN0IHJlY29yZElkRGlnZXN0Q29sdW1uID0gY29sdW1ucy5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT09IFwicmVjb3JkX2lkX2RpZ2VzdFwiKVxuICAgIGNvbnN0IGFsdGVyVGFibGUgPSBuZXcgVGFibGVEYXRhKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgIGxldCBzaG91bGRBbHRlciA9IGZhbHNlXG5cbiAgICBpZiAoIXJlY29yZElkQ29sdW1uKSB0aHJvdyBuZXcgRXJyb3IoYCR7QVRUQUNITUVOVFNfVEFCTEV9LnJlY29yZF9pZCBpcyBtaXNzaW5nYClcblxuICAgIGNvbnN0IHJlY29yZElkTWF4TGVuZ3RoID0gcmVjb3JkSWRDb2x1bW4uZ2V0TWF4TGVuZ3RoKClcblxuICAgIGlmICh0eXBlb2YgcmVjb3JkSWRNYXhMZW5ndGggPT09IFwibnVtYmVyXCIgJiYgcmVjb3JkSWRNYXhMZW5ndGggPiAwKSB7XG4gICAgICBmb3IgKGNvbnN0IGluZGV4IG9mIGF3YWl0IHJlY29yZElkQ29sdW1uLmdldEluZGV4ZXMoKSkge1xuICAgICAgICBpZiAoaW5kZXguaXNQcmltYXJ5S2V5KCkpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgaW5kZXhOYW1lID0gaW5kZXguZ2V0TmFtZSgpXG5cbiAgICAgICAgaWYgKCFpbmRleE5hbWUpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYSBuYW1lIGZvciAke0FUVEFDSE1FTlRTX1RBQkxFfS5yZWNvcmRfaWQgaW5kZXhgKVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLnJlbW92ZUluZGV4U1FMcyh7bmFtZTogaW5kZXhOYW1lLCB0YWJsZU5hbWU6IEFUVEFDSE1FTlRTX1RBQkxFfSkpIHtcbiAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCByZWNvcmRJZEFsdGVyVGFibGUgPSBuZXcgVGFibGVEYXRhKEFUVEFDSE1FTlRTX1RBQkxFKVxuXG4gICAgICByZWNvcmRJZEFsdGVyVGFibGUudGV4dChcInJlY29yZF9pZFwiLCB7XG4gICAgICAgIGlzTmV3Q29sdW1uOiBmYWxzZSxcbiAgICAgICAgbnVsbDogZGIuZ2V0VHlwZSgpID09PSBcInBnc3FsXCIgPyB1bmRlZmluZWQgOiBmYWxzZVxuICAgICAgfSlcblxuICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHMocmVjb3JkSWRBbHRlclRhYmxlKSkge1xuICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH1cblxuICAgIGlmICghaGFzRHJpdmVyQ29sdW1uKSB7XG4gICAgICBhbHRlclRhYmxlLnN0cmluZyhcImRyaXZlclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICBzaG91bGRBbHRlciA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAoIWhhc1N0b3JhZ2VLZXlDb2x1bW4pIHtcbiAgICAgIGFsdGVyVGFibGUuc3RyaW5nKFwic3RvcmFnZV9rZXlcIiwge251bGw6IHRydWV9KVxuICAgICAgc2hvdWxkQWx0ZXIgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCFyZWNvcmRJZERpZ2VzdENvbHVtbikge1xuICAgICAgYWx0ZXJUYWJsZS5zdHJpbmcoXCJyZWNvcmRfaWRfZGlnZXN0XCIsIHttYXhMZW5ndGg6IEFUVEFDSE1FTlRfUkVDT1JEX0lEX0RJR0VTVF9MRU5HVEgsIG51bGw6IHRydWV9KVxuICAgICAgc2hvdWxkQWx0ZXIgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKHNob3VsZEFsdGVyKSB7XG4gICAgICBjb25zdCBhbHRlclRhYmxlU1FMcyA9IGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKGFsdGVyVGFibGUpXG5cbiAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGFsdGVyVGFibGVTUUxzKSB7XG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfVxuXG4gICAgaWYgKCFyZWNvcmRJZERpZ2VzdENvbHVtbiB8fCByZWNvcmRJZERpZ2VzdENvbHVtbi5nZXROdWxsKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuYmFja2ZpbGxBdHRhY2htZW50UmVjb3JkSWREaWdlc3RzKGRiKVxuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVBdHRhY2htZW50UmVjb3JkSWREaWdlc3ROb3ROdWxsKGRiKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlQXR0YWNobWVudE93bmVySW5kZXgoZGIpXG5cbiAgICB0aGlzLl9kcml2ZXJDb2x1bW5zQXZhaWxhYmxlID0gdHJ1ZVxuICAgIHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSA9IGNvbnRlbnRCYXNlNjRDb2x1bW4gPyBjb250ZW50QmFzZTY0Q29sdW1uLmdldE51bGwoKSA6IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBCYWNrZmlsbHMgYm91bmRlZCBhdHRhY2htZW50IG93bmVyIGRpZ2VzdHMgaW4gc21hbGwgYmF0Y2hlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IGV4aXN0aW5nIHJvdyBoYXMgYSBkaWdlc3QuXG4gICAqL1xuICBhc3luYyBiYWNrZmlsbEF0dGFjaG1lbnRSZWNvcmRJZERpZ2VzdHMoZGIpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3JlY29yZF9pZF9kaWdlc3Q6IG51bGx9KVxuICAgICAgICAubGltaXQoQVRUQUNITUVOVF9SRUNPUkRfSURfRElHRVNUX01JR1JBVElPTl9CQVRDSF9TSVpFKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgaWYgKHR5cGVvZiByb3cuaWQgIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHJvdy5yZWNvcmRfaWQgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGNhbm9uaWNhbCBhdHRhY2htZW50IGlkZW50aXR5IHN0cmluZ3Mgd2hpbGUgYmFja2ZpbGxpbmcgJHtBVFRBQ0hNRU5UU19UQUJMRX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgZGIudXBkYXRlKHtcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IHJvdy5pZH0sXG4gICAgICAgICAgZGF0YToge3JlY29yZF9pZF9kaWdlc3Q6IGF0dGFjaG1lbnRSZWNvcmRJZERpZ2VzdChyb3cucmVjb3JkX2lkKX0sXG4gICAgICAgICAgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBpZiAocm93cy5sZW5ndGggPCBBVFRBQ0hNRU5UX1JFQ09SRF9JRF9ESUdFU1RfTUlHUkFUSU9OX0JBVENIX1NJWkUpIHJldHVyblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNYWtlcyB0aGUgYmFja2ZpbGxlZCBhdHRhY2htZW50IG93bmVyIGRpZ2VzdCByZXF1aXJlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBkaWdlc3QgY29sdW1uIGlzIG5vbi1udWxsYWJsZS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUF0dGFjaG1lbnRSZWNvcmRJZERpZ2VzdE5vdE51bGwoZGIpIHtcbiAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgIGNvbnN0IHJlY29yZElkRGlnZXN0Q29sdW1uID0gYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lT3JGYWlsKFwicmVjb3JkX2lkX2RpZ2VzdFwiKVxuXG4gICAgaWYgKCFyZWNvcmRJZERpZ2VzdENvbHVtbi5nZXROdWxsKCkpIHJldHVyblxuXG4gICAgY29uc3QgYWx0ZXJUYWJsZSA9IG5ldyBUYWJsZURhdGEoQVRUQUNITUVOVFNfVEFCTEUpXG5cbiAgICBhbHRlclRhYmxlLnN0cmluZyhcInJlY29yZF9pZF9kaWdlc3RcIiwge1xuICAgICAgaXNOZXdDb2x1bW46IGZhbHNlLFxuICAgICAgbWF4TGVuZ3RoOiBBVFRBQ0hNRU5UX1JFQ09SRF9JRF9ESUdFU1RfTEVOR1RILFxuICAgICAgbnVsbDogZmFsc2VcbiAgICB9KVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHMoYWx0ZXJUYWJsZSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYXR0YWNobWVudCBvd25lciBxdWVyaWVzIHJldGFpbiBhIGJvdW5kZWQgY29tcG9zaXRlIGluZGV4LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIG93bmVyIGluZGV4IGV4aXN0cy5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUF0dGFjaG1lbnRPd25lckluZGV4KGRiKSB7XG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICBjb25zdCBpbmRleGVzID0gYXdhaXQgdGFibGUuZ2V0SW5kZXhlcygpXG4gICAgY29uc3Qgb3duZXJJbmRleCA9IGluZGV4ZXMuZmluZCgoaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGNvbHVtbk5hbWVzID0gaW5kZXguZ2V0Q29sdW1uTmFtZXMoKVxuXG4gICAgICByZXR1cm4gY29sdW1uTmFtZXMubGVuZ3RoID09PSAyICYmIGNvbHVtbk5hbWVzWzBdID09PSBcInJlY29yZF90eXBlXCIgJiYgY29sdW1uTmFtZXNbMV0gPT09IFwicmVjb3JkX2lkX2RpZ2VzdFwiXG4gICAgfSlcblxuICAgIGlmIChvd25lckluZGV4KSByZXR1cm5cblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmNyZWF0ZUluZGV4U1FMcyh7XG4gICAgICBjb2x1bW5zOiBbXCJyZWNvcmRfdHlwZVwiLCBcInJlY29yZF9pZF9kaWdlc3RcIl0sXG4gICAgICBpZk5vdEV4aXN0czogdHJ1ZSxcbiAgICAgIG5hbWU6IEFUVEFDSE1FTlRfT1dORVJfSU5ERVhfTkFNRSxcbiAgICAgIHRhYmxlTmFtZTogQVRUQUNITUVOVFNfVEFCTEVcbiAgICB9KSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkIGF0dGFjaG1lbnQgcm93LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5yb3cgLSBBdHRhY2htZW50IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QnVmZmVyPn0gLSBBdHRhY2htZW50IGJ5dGVzLlxuICAgKi9cbiAgYXN5bmMgcmVhZEF0dGFjaG1lbnRSb3coe21vZGVsLCBuYW1lLCByb3d9KSB7XG4gICAgaWYgKHR5cGVvZiByb3cuY29udGVudF9iYXNlNjQgPT09IFwic3RyaW5nXCIgJiYgcm93LmNvbnRlbnRfYmFzZTY0Lmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBCdWZmZXIuZnJvbShyb3cuY29udGVudF9iYXNlNjQsIFwiYmFzZTY0XCIpXG4gICAgfVxuXG4gICAgY29uc3Qgc3RvcmFnZUtleSA9IHR5cGVvZiByb3cuc3RvcmFnZV9rZXkgPT09IFwic3RyaW5nXCIgJiYgcm93LnN0b3JhZ2Vfa2V5Lmxlbmd0aCA+IDAgPyByb3cuc3RvcmFnZV9rZXkgOiBudWxsXG5cbiAgICBpZiAoIXN0b3JhZ2VLZXkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCByb3cgJHtTdHJpbmcocm93LmlkKX0gaXMgbWlzc2luZyBzdG9yYWdlIGtleWApXG4gICAgfVxuXG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lLCByb3d9KVxuXG4gICAgcmV0dXJuIGF3YWl0IGF0dGFjaG1lbnREcml2ZXIucmVhZCh7XG4gICAgICBtb2RlbCxcbiAgICAgIG5hbWUsXG4gICAgICByb3csXG4gICAgICBzdG9yYWdlS2V5XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgcm93IHVybC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mucm93IC0gQXR0YWNobWVudCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIEF0dGFjaG1lbnQgVVJMLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNobWVudFJvd1VybCh7bW9kZWwsIG5hbWUsIHJvd30pIHtcbiAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyID0gYXdhaXQgdGhpcy5yZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWUsIHJvd30pXG5cbiAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnREcml2ZXIudXJsICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzdG9yYWdlS2V5ID0gdHlwZW9mIHJvdy5zdG9yYWdlX2tleSA9PT0gXCJzdHJpbmdcIiAmJiByb3cuc3RvcmFnZV9rZXkubGVuZ3RoID4gMFxuICAgICAgPyByb3cuc3RvcmFnZV9rZXlcbiAgICAgIDogKHR5cGVvZiByb3cuaWQgPT09IFwic3RyaW5nXCIgPyByb3cuaWQgOiBcIlwiKVxuXG4gICAgaWYgKCFzdG9yYWdlS2V5KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGF3YWl0IGF0dGFjaG1lbnREcml2ZXIudXJsKHtcbiAgICAgIG1vZGVsLFxuICAgICAgbmFtZSxcbiAgICAgIHJvdyxcbiAgICAgIHN0b3JhZ2VLZXlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvbmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5pZF0gLSBPcHRpb25hbCBhdHRhY2htZW50IGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBBdHRhY2htZW50IHJvdy5cbiAgICovXG4gIGFzeW5jIGZpbmRPbmUoe2lkLCBtb2RlbCwgbmFtZX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KG1vZGVsKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZFR5cGUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICAgIGNvbnN0IHJlY29yZElkID0gYXR0YWNobWVudFJlY29yZElkKG1vZGVsKVxuICAgICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oQVRUQUNITUVOVFNfVEFCTEUpXG4gICAgICAgIC53aGVyZShhdHRhY2htZW50T3duZXJDb25kaXRpb25zKHtuYW1lLCByZWNvcmRJZCwgcmVjb3JkVHlwZX0pKVxuICAgICAgICAub3JkZXIoXCJwb3NpdGlvbiBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBERVNDXCIpXG4gICAgICAgIC5saW1pdCgxKVxuXG4gICAgICBpZiAoaWQpIHtcbiAgICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSh7aWR9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG5cbiAgICAgIHJldHVybiByb3dzWzBdIHx8IG51bGxcbiAgICB9LCBtb2RlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgbWFueS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IC0gQXR0YWNobWVudCByb3dzLlxuICAgKi9cbiAgYXN5bmMgZmluZE1hbnkoe21vZGVsLCBuYW1lfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkobW9kZWwpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkVHlwZSA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgICAgY29uc3QgcmVjb3JkSWQgPSBhdHRhY2htZW50UmVjb3JkSWQobW9kZWwpXG4gICAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoYXR0YWNobWVudE93bmVyQ29uZGl0aW9ucyh7bmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KSlcbiAgICAgICAgLm9yZGVyKFwicG9zaXRpb24gQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG5cbiAgICAgIHJldHVybiBhd2FpdCBxdWVyeS5yZXN1bHRzKClcbiAgICB9LCBtb2RlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBNb3ZlcyBldmVyeSBhdHRhY2htZW50IHJvdyB0byBhIHJlY29yZCdzIG5ldyBwcmltYXJ5LWtleSBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbm5lY3Rpb24gLSBUcmFuc2FjdGlvbi1vd25pbmcgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gQXR0YWNobWVudCBvd25lciBhZnRlciB0aGUga2V5IGNoYW5nZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gYXJncy5uZXh0SWRlbnRpdHkgLSBOZXcgb3duZXIgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGFyZ3MucHJldmlvdXNJZGVudGl0eSAtIFBlcnNpc3RlZCBvd25lciBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgb3duZXJzaGlwIGlzIG1pZ3JhdGVkLlxuICAgKi9cbiAgYXN5bmMgbWlncmF0ZVJlY29yZElkZW50aXR5KHtjb25uZWN0aW9uLCBtb2RlbCwgbmV4dElkZW50aXR5LCBwcmV2aW91c0lkZW50aXR5fSkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gICAgY29uc3QgbmV4dFJlY29yZElkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgbmV4dElkZW50aXR5KVxuICAgIGNvbnN0IHByZXZpb3VzUmVjb3JkSWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuXG4gICAgaWYgKG5leHRSZWNvcmRJZCA9PT0gcHJldmlvdXNSZWNvcmRJZCkgcmV0dXJuXG5cbiAgICBpZiAoIWF3YWl0IGNvbm5lY3Rpb24udGFibGVFeGlzdHMoQVRUQUNITUVOVFNfVEFCTEUpKSByZXR1cm5cblxuICAgIGF3YWl0IGNvbm5lY3Rpb24udXBkYXRlKHtcbiAgICAgIGNvbmRpdGlvbnM6IGF0dGFjaG1lbnRPd25lckNvbmRpdGlvbnMoe1xuICAgICAgICByZWNvcmRJZDogcHJldmlvdXNSZWNvcmRJZCxcbiAgICAgICAgcmVjb3JkVHlwZTogbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG4gICAgICB9KSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgcmVjb3JkX2lkOiBuZXh0UmVjb3JkSWQsXG4gICAgICAgIHJlY29yZF9pZF9kaWdlc3Q6IGF0dGFjaG1lbnRSZWNvcmRJZERpZ2VzdChuZXh0UmVjb3JkSWQpXG4gICAgICB9LFxuICAgICAgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUgYXR0YWNobWVudCByb3cgc3RvcmFnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mucm93IC0gQXR0YWNobWVudCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcm93IHN0b3JhZ2UgaGFzIGJlZW4gZGVsZXRlZC5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZUF0dGFjaG1lbnRSb3dTdG9yYWdlKHttb2RlbCwgbmFtZSwgcm93fSkge1xuICAgIGNvbnN0IHN0b3JhZ2VLZXkgPSB0eXBlb2Ygcm93LnN0b3JhZ2Vfa2V5ID09PSBcInN0cmluZ1wiICYmIHJvdy5zdG9yYWdlX2tleS5sZW5ndGggPiAwID8gcm93LnN0b3JhZ2Vfa2V5IDogbnVsbFxuXG4gICAgaWYgKCFzdG9yYWdlS2V5KSByZXR1cm5cblxuICAgIGNvbnN0IGF0dGFjaG1lbnREcml2ZXIgPSBhd2FpdCB0aGlzLnJlc29sdmVBdHRhY2htZW50RHJpdmVyKHttb2RlbCwgbmFtZSwgcm93fSlcblxuICAgIGlmICh0eXBlb2YgYXR0YWNobWVudERyaXZlci5kZWxldGUgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuXG5cbiAgICBhd2FpdCBhdHRhY2htZW50RHJpdmVyLmRlbGV0ZSh7XG4gICAgICBtb2RlbCxcbiAgICAgIG5hbWUsXG4gICAgICByb3csXG4gICAgICBzdG9yYWdlS2V5XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQdXJnZXMgZXZlcnkgYXR0YWNobWVudCBzdG9yZWQgdW5kZXIgKG1vZGVsLCBuYW1lKTogZGVsZXRlcyBlYWNoIHJvdydzXG4gICAqIGJhY2tpbmcgc3RvcmFnZSBhbmQgdGhlbiByZW1vdmVzIHRoZSBhdHRhY2htZW50IHJvd3MuIFVzZWQgdG8gY2xlYW4gdXAgYW5cbiAgICogb3duZXIgcmVjb3JkJ3MgYXR0YWNobWVudHMgYmVmb3JlL3doZW4gdGhlIG93bmVyIGlzIGRlc3Ryb3llZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBOdW1iZXIgb2YgYXR0YWNobWVudHMgcHVyZ2VkLlxuICAgKi9cbiAgYXN5bmMgcHVyZ2VBbGwoe21vZGVsLCBuYW1lfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkobW9kZWwpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkVHlwZSA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgICAgY29uc3QgcmVjb3JkSWQgPSBhdHRhY2htZW50UmVjb3JkSWQobW9kZWwpXG4gICAgICAvKiogQHR5cGUge0FycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oQVRUQUNITUVOVFNfVEFCTEUpXG4gICAgICAgIC53aGVyZShhdHRhY2htZW50T3duZXJDb25kaXRpb25zKHtuYW1lLCByZWNvcmRJZCwgcmVjb3JkVHlwZX0pKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIC8vIFJlZnVzZSB0byBwdXJnZSB3aGVuIGFueSByb3cncyBkcml2ZXIgY2Fubm90IGRlbGV0ZSBpdHMgYmFja2luZyBzdG9yYWdlOlxuICAgICAgLy8gcmVtb3ZpbmcgdGhlIHJvdyB3aGlsZSB0aGUgb2JqZWN0IHN0YXlzIGJlaGluZCB3b3VsZCBsZWFrIHN0b3JhZ2UgYW5kXG4gICAgICAvLyBkaXNjYXJkIHRoZSBtZXRhZGF0YSBuZWVkZWQgdG8gcmV0cnkgY2xlYW51cC4gRmFpbCBsb3VkbHkgaW5zdGVhZC5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lLCByb3d9KVxuXG4gICAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudERyaXZlci5kZWxldGUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHB1cmdlIGF0dGFjaG1lbnQgJHtyb3cuaWR9IGZvciAke3JlY29yZFR5cGV9IyR7cmVjb3JkSWR9ICgke25hbWV9KTogaXRzIHN0b3JhZ2UgZHJpdmVyIGRvZXMgbm90IHN1cHBvcnQgZGVsZXRpb24uYClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZGVsZXRlQXR0YWNobWVudFJvd1N0b3JhZ2Uoe21vZGVsLCBuYW1lLCByb3d9KVxuICAgICAgICAvLyBEZWxldGUgb25seSB0aGUgc25hcHNob3R0ZWQgcm93IGJ5IGlkLCBzbyBhbiBhdHRhY2htZW50IGluc2VydGVkIGZvciB0aGVcbiAgICAgICAgLy8gc2FtZSAocmVjb3JkLCBuYW1lKSBhZnRlciB0aGUgc25hcHNob3QgaXMgbm90IHJlbW92ZWQgd2l0aCBpdHMgc3RvcmFnZVxuICAgICAgICAvLyBzdGlsbCBwcmVzZW50ICh3aGljaCB3b3VsZCBsZWF2ZSBpdCBhcyB1bnJlYWNoYWJsZSBzdG9yYWdlKS5cbiAgICAgICAgYXdhaXQgZGIuZGVsZXRlKHtjb25kaXRpb25zOiB7aWQ6IHJvdy5pZH0sIHRhYmxlTmFtZTogQVRUQUNITUVOVFNfVEFCTEV9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcm93cy5sZW5ndGhcbiAgICB9LCBtb2RlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgZHJpdmVyIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkcml2ZXJOYW1lIC0gRHJpdmVyIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gQXR0YWNobWVudCBzdG9yYWdlIGRyaXZlciBpbnN0YW5jZS5cbiAgICovXG4gIGFzeW5jIGF0dGFjaG1lbnREcml2ZXJCeU5hbWUoZHJpdmVyTmFtZSkge1xuICAgIGlmICh0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5TmFtZS5oYXMoZHJpdmVyTmFtZSkpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlOYW1lLmdldChkcml2ZXJOYW1lKSlcbiAgICB9XG5cbiAgICBjb25zdCBhdHRhY2htZW50Q29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRBdHRhY2htZW50c0NvbmZpZ3VyYXRpb24/LigpIHx8IHt9XG4gICAgY29uc3QgY29uZmlndXJlZERyaXZlciA9IGF0dGFjaG1lbnRDb25maWd1cmF0aW9uLmRyaXZlcnM/Lltkcml2ZXJOYW1lXVxuICAgIC8qKlxuICAgICAqIERlZmluZXMgYXR0YWNobWVudERyaXZlci5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGxldCBhdHRhY2htZW50RHJpdmVyXG5cbiAgICBpZiAoIWNvbmZpZ3VyZWREcml2ZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gY29uZmlndXJlZCBhdHRhY2htZW50IHN0b3JhZ2UgZHJpdmVyIG5hbWVkIFwiJHtkcml2ZXJOYW1lfVwiYClcbiAgICB9IGVsc2UgaWYgKGNvbmZpZ3VyZWREcml2ZXIuaW5zdGFuY2UgJiYgdHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIuaW5zdGFuY2UgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBjb25maWd1cmVkRHJpdmVyLmluc3RhbmNlXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgY29uZmlndXJlZERyaXZlci5kcml2ZXJDbGFzcyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhdHRhY2htZW50RHJpdmVyID0gbmV3IGNvbmZpZ3VyZWREcml2ZXIuZHJpdmVyQ2xhc3Moe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgIG5hbWU6IGRyaXZlck5hbWUsXG4gICAgICAgIG9wdGlvbnM6IGNvbmZpZ3VyZWREcml2ZXJcbiAgICAgIH0pXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgY29uZmlndXJlZERyaXZlci5jcmVhdGUgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXR0YWNobWVudERyaXZlciA9IGNvbmZpZ3VyZWREcml2ZXIuY3JlYXRlKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBuYW1lOiBkcml2ZXJOYW1lLFxuICAgICAgICBvcHRpb25zOiBjb25maWd1cmVkRHJpdmVyXG4gICAgICB9KVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgXCIke2RyaXZlck5hbWV9XCIgbXVzdCBkZWZpbmUgaW5zdGFuY2UsIGRyaXZlckNsYXNzLCBvciBjcmVhdGVgKVxuICAgIH1cblxuICAgIGlmICghYXR0YWNobWVudERyaXZlciB8fCB0eXBlb2YgYXR0YWNobWVudERyaXZlci53cml0ZSAhPT0gXCJmdW5jdGlvblwiIHx8IHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLnJlYWQgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50IHN0b3JhZ2UgZHJpdmVyIFwiJHtkcml2ZXJOYW1lfVwiIG11c3QgaW1wbGVtZW50IHdyaXRlL3JlYWRgKVxuICAgIH1cblxuICAgIHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlOYW1lLnNldChkcml2ZXJOYW1lLCBhdHRhY2htZW50RHJpdmVyKVxuXG4gICAgcmV0dXJuIGF0dGFjaG1lbnREcml2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgZHJpdmVyIGJ5IHJlZmVyZW5jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0F0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5kcml2ZXJSZWZlcmVuY2UgLSBEcml2ZXIgY2xhc3Mgb3IgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBBdHRhY2htZW50IGRyaXZlciBpbnN0YW5jZS5cbiAgICovXG4gIGF0dGFjaG1lbnREcml2ZXJCeVJlZmVyZW5jZSh7YXR0YWNobWVudE5hbWUsIGRyaXZlclJlZmVyZW5jZSwgbW9kZWxDbGFzc30pIHtcbiAgICBpZiAodGhpcy5fYXR0YWNobWVudERyaXZlcnNCeVJlZmVyZW5jZS5oYXMoZHJpdmVyUmVmZXJlbmNlKSkge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5fYXR0YWNobWVudERyaXZlcnNCeVJlZmVyZW5jZS5nZXQoZHJpdmVyUmVmZXJlbmNlKSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGF0dGFjaG1lbnREcml2ZXIuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBsZXQgYXR0YWNobWVudERyaXZlclxuXG4gICAgaWYgKHR5cGVvZiBkcml2ZXJSZWZlcmVuY2UgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgY29uc3QgRHJpdmVyQ2xhc3MgPSAvKiogQHR5cGUge0F0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3Rvcn0gKi8gKGRyaXZlclJlZmVyZW5jZSlcblxuICAgICAgYXR0YWNobWVudERyaXZlciA9IG5ldyBEcml2ZXJDbGFzcyh7XG4gICAgICAgIGF0dGFjaG1lbnROYW1lLFxuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgIG1vZGVsQ2xhc3NcbiAgICAgIH0pXG4gICAgfSBlbHNlIGlmIChkcml2ZXJSZWZlcmVuY2UgJiYgdHlwZW9mIGRyaXZlclJlZmVyZW5jZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgYXR0YWNobWVudERyaXZlciA9IGRyaXZlclJlZmVyZW5jZVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYXR0YWNobWVudCBkcml2ZXIgcmVmZXJlbmNlIGZvciAke21vZGVsQ2xhc3MubmFtZX0jJHthdHRhY2htZW50TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYXR0YWNobWVudERyaXZlci53cml0ZSAhPT0gXCJmdW5jdGlvblwiIHx8IHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLnJlYWQgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50IGRyaXZlciBmb3IgJHttb2RlbENsYXNzLm5hbWV9IyR7YXR0YWNobWVudE5hbWV9IG11c3QgaW1wbGVtZW50IHdyaXRlL3JlYWRgKVxuICAgIH1cblxuICAgIHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlSZWZlcmVuY2Uuc2V0KGRyaXZlclJlZmVyZW5jZSwgYXR0YWNobWVudERyaXZlcilcblxuICAgIHJldHVybiBhdHRhY2htZW50RHJpdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRyaXZlciBuYW1lIGZvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IGRyaXZlciBuYW1lLlxuICAgKi9cbiAgX2F0dGFjaG1lbnREcml2ZXJOYW1lRm9yKHttb2RlbCwgbmFtZX0pIHtcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRhY2htZW50QnlOYW1lKG5hbWUpXG4gICAgY29uc3QgY29uZmlndXJlZERyaXZlciA9IGF0dGFjaG1lbnREZWZpbml0aW9uLmRyaXZlclxuICAgIGNvbnN0IGF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRBdHRhY2htZW50c0NvbmZpZ3VyYXRpb24/LigpIHx8IHt9XG4gICAgY29uc3QgZGVmYXVsdERyaXZlciA9IGF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbi5kZWZhdWx0RHJpdmVyXG5cbiAgICBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIgPT09IFwic3RyaW5nXCIgJiYgY29uZmlndXJlZERyaXZlci5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gY29uZmlndXJlZERyaXZlclxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgY29uZmlndXJlZERyaXZlciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gY29uZmlndXJlZERyaXZlci5uYW1lIHx8IFwiY3VzdG9tXCJcbiAgICB9XG5cbiAgICBpZiAoY29uZmlndXJlZERyaXZlciAmJiB0eXBlb2YgY29uZmlndXJlZERyaXZlciA9PT0gXCJvYmplY3RcIikge1xuICAgICAgY29uc3QgY29uc3RydWN0b3JOYW1lID0gY29uZmlndXJlZERyaXZlci5jb25zdHJ1Y3Rvcj8ubmFtZVxuXG4gICAgICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yTmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBjb25zdHJ1Y3Rvck5hbWUubGVuZ3RoID4gMCAmJiBjb25zdHJ1Y3Rvck5hbWUgIT09IFwiT2JqZWN0XCIpIHtcbiAgICAgICAgcmV0dXJuIGNvbnN0cnVjdG9yTmFtZVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gXCJjdXN0b21cIlxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZGVmYXVsdERyaXZlciA9PT0gXCJzdHJpbmdcIiAmJiBkZWZhdWx0RHJpdmVyLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBkZWZhdWx0RHJpdmVyXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBObyBhdHRhY2htZW50IGRyaXZlciBjb25maWd1cmVkIGZvciAke21vZGVsLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSMke25hbWV9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgYXR0YWNobWVudCBkcml2ZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5yb3ddIC0gQXR0YWNobWVudCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gQXR0YWNobWVudCBzdG9yYWdlIGRyaXZlciBpbnN0YW5jZS5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVBdHRhY2htZW50RHJpdmVyKHttb2RlbCwgbmFtZSwgcm93fSkge1xuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldEF0dGFjaG1lbnRCeU5hbWUobmFtZSlcbiAgICBjb25zdCBjb25maWd1cmVkRHJpdmVyID0gYXR0YWNobWVudERlZmluaXRpb24uZHJpdmVyXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkRHJpdmVyID09PSBcImZ1bmN0aW9uXCIgfHwgKGNvbmZpZ3VyZWREcml2ZXIgJiYgdHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIgPT09IFwib2JqZWN0XCIpKSB7XG4gICAgICByZXR1cm4gdGhpcy5hdHRhY2htZW50RHJpdmVyQnlSZWZlcmVuY2Uoe1xuICAgICAgICBhdHRhY2htZW50TmFtZTogbmFtZSxcbiAgICAgICAgZHJpdmVyUmVmZXJlbmNlOiBjb25maWd1cmVkRHJpdmVyLFxuICAgICAgICBtb2RlbENsYXNzOiBtb2RlbC5nZXRNb2RlbENsYXNzKClcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgZmFsbGJhY2tEcml2ZXJOYW1lID0gdHlwZW9mIHJvdz8uZHJpdmVyID09PSBcInN0cmluZ1wiICYmIHJvdy5kcml2ZXIubGVuZ3RoID4gMFxuICAgICAgPyByb3cuZHJpdmVyXG4gICAgICA6IHRoaXMuX2F0dGFjaG1lbnREcml2ZXJOYW1lRm9yKHttb2RlbCwgbmFtZX0pXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5hdHRhY2htZW50RHJpdmVyQnlOYW1lKGZhbGxiYWNrRHJpdmVyTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgcG9zaXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERCIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlY29yZElkIC0gUmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWNvcmRUeXBlIC0gUmVjb3JkIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTmV4dCBwb3NpdGlvbi5cbiAgICovXG4gIGFzeW5jIF9uZXh0UG9zaXRpb24oe2RiLCBuYW1lLCByZWNvcmRJZCwgcmVjb3JkVHlwZX0pIHtcbiAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oQVRUQUNITUVOVFNfVEFCTEUpXG4gICAgICAud2hlcmUoYXR0YWNobWVudE93bmVyQ29uZGl0aW9ucyh7bmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KSlcbiAgICAgIC5vcmRlcihcInBvc2l0aW9uIERFU0NcIilcbiAgICAgIC5saW1pdCgxKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcbiAgICBjb25zdCBjdXJyZW50Um93ID0gLyoqIEB0eXBlIHt7cG9zaXRpb24/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsfSB8IHVuZGVmaW5lZH0gKi8gKHJvd3NbMF0pXG4gICAgY29uc3QgY3VycmVudCA9IE51bWJlcihjdXJyZW50Um93Py5wb3NpdGlvbilcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGN1cnJlbnQpKSByZXR1cm4gMFxuXG4gICAgcmV0dXJuIGN1cnJlbnQgKyAxXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGRiLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gW21vZGVsXSAtIE9wZXJhdGlvbi1vd25pbmcgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRGIoY2FsbGJhY2ssIG1vZGVsKSB7XG4gICAgaWYgKG1vZGVsICYmIG1vZGVsLmRhdGFiYXNlT3BlcmF0aW9uKCkpIHJldHVybiBhd2FpdCBjYWxsYmFjayhtb2RlbC5jb25uZWN0aW9uKCkpXG5cbiAgICBjb25zdCBwb29sID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbCh0aGlzLmRhdGFiYXNlSWRlbnRpZmllcilcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIHJlc3VsdC5cbiAgICAgKiBAdHlwZSB7VCB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgcmVzdWx0XG5cbiAgICBhd2FpdCBwb29sLndpdGhDb25uZWN0aW9uKHtuYW1lOiBcIlJlY29yZCBhdHRhY2htZW50IHN0b3JlXCJ9LCBhc3luYyAoZGIpID0+IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IGNhbGxiYWNrKGRiKVxuICAgIH0pXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtUfSAqLyAocmVzdWx0KVxuICB9XG59XG4iXX0=