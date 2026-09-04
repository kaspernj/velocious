// @ts-check
import UUID from "pure-uuid";
import TableData from "../../table-data/index.js";
import { modelPrimaryKeyCacheKey } from "../../../utils/model-primary-key.js";
import normalizeRecordAttachmentInput from "./normalize-input.js";
/**
 * AttachmentDriverConstructor type.
 * @typedef {import("../../../configuration-types.js").AttachmentDriverConstructor} AttachmentDriverConstructor */
const ATTACHMENTS_TABLE = "velocious_attachments";
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
                        .where({ name, record_id: recordId, record_type: recordType })
                        .results();
                    for (const existingRow of existingRows) {
                        await this.deleteAttachmentRowStorage({ model, name, row: existingRow });
                    }
                    await db.delete({
                        conditions: { name, record_id: recordId, record_type: recordType },
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
        if (shouldAlter) {
            const alterTableSQLs = await db.alterTableSQLs(alterTable);
            for (const sql of alterTableSQLs) {
                await db.query(sql);
            }
            db.clearSchemaCache();
        }
        this._driverColumnsAvailable = true;
        this._contentBase64Nullable = contentBase64Column ? contentBase64Column.getNull() : true;
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
                .where({ name, record_id: recordId, record_type: recordType })
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
                .where({ name, record_id: recordId, record_type: recordType })
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
            conditions: {
                record_id: previousRecordId,
                record_type: model.getModelClass().getModelName()
            },
            data: { record_id: nextRecordId },
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
                .where({ name, record_id: recordId, record_type: recordType })
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
            .where({ name, record_id: recordId, record_type: recordType })
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F0dGFjaG1lbnRzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMkJBQTJCLENBQUE7QUFDakQsT0FBTyxFQUFDLHVCQUF1QixFQUFDLE1BQU0scUNBQXFDLENBQUE7QUFDM0UsT0FBTyw4QkFBOEIsTUFBTSxzQkFBc0IsQ0FBQTtBQUVqRTs7a0hBRWtIO0FBQ2xILE1BQU0saUJBQWlCLEdBQUcsdUJBQXVCLENBQUE7QUFFakQ7O3VHQUV1RztBQUN2RyxNQUFNLHFCQUFxQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFM0M7OztHQUdHO0FBQ0gsU0FBUyxZQUFZO0lBQ25CLE9BQU8sSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUE7QUFDN0IsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGtCQUFrQixDQUFDLEtBQUs7SUFDL0IsT0FBTyx1QkFBdUIsQ0FBQyxLQUFLLENBQUMsYUFBYSxFQUFFLENBQUMsVUFBVSxFQUFFLEVBQUUsS0FBSyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUE7QUFDaEYsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGdCQUFnQixDQUFDLEtBQUs7SUFDN0IsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixFQUFFLENBQUE7SUFFM0MsSUFBSSxTQUFTO1FBQUUsT0FBTyxTQUFTLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtJQUVsRCxPQUFPLEdBQUcsS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFDLHFCQUFxQixFQUFFLEVBQUUsQ0FBQTtBQUMzRCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSw4QkFBOEIsQ0FBQyxLQUFLO0lB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RSxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDbkQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxhQUFhLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3ZELEtBQUssQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDdEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ2hELEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDeEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUN2QyxLQUFLLENBQUMsTUFBTSxDQUFDLGNBQWMsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzFDLEtBQUssQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDeEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUNwQyxLQUFLLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3pDLEtBQUssQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUMxQyxLQUFLLENBQUMsTUFBTSxDQUFDLGVBQWUsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMs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QU0sVUFBVSxHQUFHLDhEQUE4RCxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDM0YsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQTtRQUU1QyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUM7WUFBRSxPQUFPLENBQUMsQ0FBQTtRQUV2QyxPQUFPLE9BQU8sR0FBRyxDQUFDLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEtBQUs7UUFDM0IsSUFBSSxLQUFLLElBQUksS0FBSyxDQUFDLGlCQUFpQixFQUFFO1lBQUUsT0FBTyxNQUFNLFFBQVEsQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQTtRQUVqRixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtRQUN4RTs7bUNBRTJCO1FBQzNCLElBQUksTUFBTSxDQUFBO1FBRVYsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFDLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO1lBQ3hFLE1BQU0sR0FBRyxNQUFNLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUM3QixDQUFDLENBQUMsQ0FBQTtRQUVGLE9BQU8sZ0JBQWdCLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNsQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi8uLi90YWJsZS1kYXRhL2luZGV4LmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXl9IGZyb20gXCIuLi8uLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQgbm9ybWFsaXplUmVjb3JkQXR0YWNobWVudElucHV0IGZyb20gXCIuL25vcm1hbGl6ZS1pbnB1dC5qc1wiXG5cbi8qKlxuICogQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3J9IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciAqL1xuY29uc3QgQVRUQUNITUVOVFNfVEFCTEUgPSBcInZlbG9jaW91c19hdHRhY2htZW50c1wiXG5cbi8qKlxuICogU3RvcmVzIGJ5IGNvbmZpZ3VyYXRpb24uXG4gKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi8uLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRzU3RvcmU+Pn0gKi9cbmNvbnN0IHN0b3Jlc0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBSdW5zIGdlbmVyYXRlIHV1aWQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEdlbmVyYXRlZCBVVUlEIHY0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVVVSUQoKSB7XG4gIHJldHVybiBuZXcgVVVJRCg0KS5mb3JtYXQoKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNhbm9uaWNhbCBzdG9yZWQgb3duZXIgaWRlbnRpdHkgZm9yIGEgbW9kZWwgYXR0YWNobWVudC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBBdHRhY2htZW50IG93bmVyLlxuICogQHJldHVybnMge3N0cmluZ30gLSBDYW5vbmljYWwgb3duZXIgaWRlbnRpdHkuXG4gKi9cbmZ1bmN0aW9uIGF0dGFjaG1lbnRSZWNvcmRJZChtb2RlbCkge1xuICByZXR1cm4gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkobW9kZWwuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKSwgbW9kZWwuaWQoKSlcbn1cblxuLyoqXG4gKiBSdW5zIHN0b3JlIGtleSBmb3IgbW9kZWwuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFN0b3JlIGtleS5cbiAqL1xuZnVuY3Rpb24gc3RvcmVLZXlGb3JNb2RlbChtb2RlbCkge1xuICBjb25zdCBvcGVyYXRpb24gPSBtb2RlbC5kYXRhYmFzZU9wZXJhdGlvbigpXG5cbiAgaWYgKG9wZXJhdGlvbikgcmV0dXJuIG9wZXJhdGlvbi5kYXRhYmFzZUlkZW50aXR5KClcblxuICByZXR1cm4gYCR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldERhdGFiYXNlSWRlbnRpZmllcigpfWBcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSByZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWwgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICogQHJldHVybnMge1JlY29yZEF0dGFjaG1lbnRzU3RvcmV9IC0gU3RvcmUgaW5zdGFuY2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWwobW9kZWwpIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKClcbiAgbGV0IHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyID0gc3RvcmVzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gIGlmICghc3RvcmVzQnlEYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICBzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllciA9IG5ldyBNYXAoKVxuICAgIHN0b3Jlc0J5Q29uZmlndXJhdGlvbi5zZXQoY29uZmlndXJhdGlvbiwgc3RvcmVzQnlEYXRhYmFzZUlkZW50aWZpZXIpXG4gIH1cblxuICBjb25zdCBrZXkgPSBzdG9yZUtleUZvck1vZGVsKG1vZGVsKVxuICBsZXQgc3RvcmUgPSBzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllci5nZXQoa2V5KVxuXG4gIGlmIChzdG9yZSkgcmV0dXJuIHN0b3JlXG5cbiAgc3RvcmUgPSBuZXcgUmVjb3JkQXR0YWNobWVudHNTdG9yZSh7XG4gICAgY29uZmlndXJhdGlvbixcbiAgICBkYXRhYmFzZUlkZW50aWZpZXI6IG1vZGVsLmRhdGFiYXNlT3BlcmF0aW9uKCk/LmRhdGFiYXNlSWRlbnRpZmllcigpIHx8IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICB9KVxuXG4gIHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyLnNldChrZXksIHN0b3JlKVxuXG4gIHJldHVybiBzdG9yZVxufVxuXG4vKipcbiAqIEF0dGFjaG1lbnQgcGVyc2lzdGVuY2Ugc3RvcmUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFJlY29yZEF0dGFjaG1lbnRzU3RvcmUge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGF0YWJhc2VJZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXJ9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX2RyaXZlckNvbHVtbnNBdmFpbGFibGUgPSBmYWxzZVxuICAgIHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSA9IHRydWVcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgdGhpcy5fYXR0YWNobWVudERyaXZlcnNCeU5hbWUgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge01hcDxBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgdGhpcy5fYXR0YWNobWVudERyaXZlcnNCeVJlZmVyZW5jZSA9IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHJlYWR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IFttb2RlbF0gLSBPcGVyYXRpb24tb3duaW5nIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNjaGVtYSBpcyByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVJlYWR5KG1vZGVsKSB7XG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmVuc3VyZVNjaGVtYShkYilcbiAgICAgIH0sIG1vZGVsKVxuICAgIH0pKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGF0dGFjaG1lbnQgc2NoZW1hIHRocm91Z2ggYW4gYWxyZWFkeS1vd25lZCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2NoZW1hIGlzIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlU2NoZW1hKGRiKSB7XG4gICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG5cbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoQVRUQUNITUVOVFNfVEFCTEUpKSB7XG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZUF0dGFjaG1lbnRTdG9yZVNjaGVtYSh7ZGJ9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKEFUVEFDSE1FTlRTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwiaWRcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJyZWNvcmRfdHlwZVwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwicmVjb3JkX2lkXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwibmFtZVwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwicG9zaXRpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJmaWxlbmFtZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImNvbnRlbnRfdHlwZVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiYnl0ZV9zaXplXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiZHJpdmVyXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzdG9yYWdlX2tleVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImNvbnRlbnRfYmFzZTY0XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwidXBkYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgdGhpcy5fZHJpdmVyQ29sdW1uc0F2YWlsYWJsZSA9IHRydWVcbiAgICB0aGlzLl9jb250ZW50QmFzZTY0TnVsbGFibGUgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2guXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucmVwbGFjZSAtIFdoZXRoZXIgdG8gcmVwbGFjZSBleGlzdGluZyBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGF0dGFjaCh7aW5wdXQsIG1vZGVsLCBuYW1lLCByZXBsYWNlfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkobW9kZWwpXG4gICAgY29uc3QgYXR0YWNobWVudHNDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbj8uKCkgfHwge31cbiAgICBjb25zdCBhbGxvd1BhdGhJbnB1dCA9IGF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbi5hbGxvd1BhdGhJbnB1dCA9PT0gdHJ1ZVxuICAgIGNvbnN0IGFsbG93ZWRQYXRoUHJlZml4ZXMgPSBBcnJheS5pc0FycmF5KGF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbi5hbGxvd2VkUGF0aFByZWZpeGVzKVxuICAgICAgPyBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24uYWxsb3dlZFBhdGhQcmVmaXhlc1xuICAgICAgOiB1bmRlZmluZWRcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRJbnB1dCA9IGF3YWl0IG5vcm1hbGl6ZVJlY29yZEF0dGFjaG1lbnRJbnB1dChpbnB1dCwge1xuICAgICAgYWxsb3dQYXRoSW5wdXQsXG4gICAgICBhbGxvd2VkUGF0aFByZWZpeGVzLFxuICAgICAgZW52aXJvbm1lbnRIYW5kbGVyOiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICB9KVxuICAgIC8qKlxuICAgICAqIEF0dGFjaG1lbnQgcGVyc2lzdGVuY2UgZXJyb3IuXG4gICAgICogVGhpcyBzdGF5cyBvcGFxdWUgc28gYW55IEphdmFTY3JpcHQgdGhyb3duIHZhbHVlIGlzIHByZXNlcnZlZCBleGFjdGx5LlxuICAgICAqIEB0eXBlIHt1bmtub3dufSAqL1xuICAgIGxldCBwZXJzaXN0ZW5jZUVycm9yID0gbnVsbFxuICAgIGxldCBwZXJzaXN0ZW5jZUZhaWxlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcGVyc2lzdGVuY2VJbnB1dCA9IGF3YWl0IHRoaXMucGVyc2lzdGVuY2VJbnB1dEZvcihub3JtYWxpemVkSW5wdXQpXG5cbiAgICAgIGF3YWl0IHRoaXMucGVyc2lzdE5vcm1hbGl6ZWRBdHRhY2htZW50KHtcbiAgICAgICAgbW9kZWwsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIG5vcm1hbGl6ZWRJbnB1dDogcGVyc2lzdGVuY2VJbnB1dCxcbiAgICAgICAgcmVwbGFjZVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcGVyc2lzdGVuY2VGYWlsZWQgPSB0cnVlXG4gICAgICBwZXJzaXN0ZW5jZUVycm9yID0gZXJyb3JcbiAgICB9XG5cbiAgICBpZiAobm9ybWFsaXplZElucHV0LnBhdGhTb3VyY2UpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG5vcm1hbGl6ZWRJbnB1dC5wYXRoU291cmNlLmNsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgaWYgKHBlcnNpc3RlbmNlRmFpbGVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgW3BlcnNpc3RlbmNlRXJyb3IsIGNsb3NlRXJyb3JdLFxuICAgICAgICAgICAgYEF0dGFjaG1lbnQgcGVyc2lzdGVuY2UgYW5kIHBhdGgtc291cmNlIGNsb3NlIGJvdGggZmFpbGVkIGZvciAke21vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKX0jJHthdHRhY2htZW50UmVjb3JkSWQobW9kZWwpfSAoJHtuYW1lfSlgLFxuICAgICAgICAgICAge2NhdXNlOiBjbG9zZUVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IGNsb3NlRXJyb3JcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocGVyc2lzdGVuY2VGYWlsZWQpIHRocm93IHBlcnNpc3RlbmNlRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXRlcmlhbGl6ZXMgcGF0aCBjb250ZW50IG9uY2Ugd2hlbiBhIGxlZ2FjeSBzY2hlbWEgcmVxdWlyZXMgQmFzZTY0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbm9ybWFsaXplLWlucHV0LmpzXCIpLk5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXR9IG5vcm1hbGl6ZWRJbnB1dCAtIE5vcm1hbGl6ZWQgYXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dD59IC0gSW5wdXQgdXNlZCBieSB0aGUgZHJpdmVyIGFuZCBkYXRhYmFzZS5cbiAgICovXG4gIGFzeW5jIHBlcnNpc3RlbmNlSW5wdXRGb3Iobm9ybWFsaXplZElucHV0KSB7XG4gICAgaWYgKHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSB8fCAhbm9ybWFsaXplZElucHV0LnBhdGhTb3VyY2UpIHJldHVybiBub3JtYWxpemVkSW5wdXRcblxuICAgIGNvbnN0IGNvbnRlbnRCdWZmZXIgPSBhd2FpdCBub3JtYWxpemVkSW5wdXQucGF0aFNvdXJjZS5yZWFkQnVmZmVyKClcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5ub3JtYWxpemVkSW5wdXQsXG4gICAgICBjb250ZW50QmFzZTY0OiBjb250ZW50QnVmZmVyLnRvU3RyaW5nKFwiYmFzZTY0XCIpLFxuICAgICAgY29udGVudEJ1ZmZlcixcbiAgICAgIHBhdGhTb3VyY2U6IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgb25lIG5vcm1hbGl6ZWQgYXR0YWNobWVudCB3aGlsZSBpdHMgcGF0aCBzb3VyY2UgcmVtYWlucyBvcGVuLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbm9ybWFsaXplLWlucHV0LmpzXCIpLk5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXR9IGFyZ3Mubm9ybWFsaXplZElucHV0IC0gTm9ybWFsaXplZCBhdHRhY2htZW50LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucmVwbGFjZSAtIFdoZXRoZXIgdG8gcmVwbGFjZSBleGlzdGluZyBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBwZXJzaXN0Tm9ybWFsaXplZEF0dGFjaG1lbnQoe21vZGVsLCBuYW1lLCBub3JtYWxpemVkSW5wdXQsIHJlcGxhY2V9KSB7XG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lfSlcbiAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyTmFtZSA9IHRoaXMuX2F0dGFjaG1lbnREcml2ZXJOYW1lRm9yKHttb2RlbCwgbmFtZX0pXG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IHJlY29yZFR5cGUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICBjb25zdCByZWNvcmRJZCA9IGF0dGFjaG1lbnRSZWNvcmRJZChtb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50SWQgPSBnZW5lcmF0ZVVVSUQoKVxuICAgIC8qKlxuICAgICAqIFdyaXR0ZW4gc3RvcmFnZSBrZXkuXG4gICAgICogQHR5cGUge3N0cmluZyB8IG51bGx9ICovXG4gICAgbGV0IHN0b3JhZ2VLZXkgPSBudWxsXG4gICAgbGV0IHJvd1BlcnNpc3RlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgd3JpdGVSZXN1bHQgPSBhd2FpdCBhdHRhY2htZW50RHJpdmVyLndyaXRlKHtcbiAgICAgICAgYXR0YWNobWVudElkLFxuICAgICAgICBpbnB1dDogbm9ybWFsaXplZElucHV0LFxuICAgICAgICBtb2RlbCxcbiAgICAgICAgbmFtZVxuICAgICAgfSlcblxuICAgICAgc3RvcmFnZUtleSA9IHdyaXRlUmVzdWx0LnN0b3JhZ2VLZXlcblxuICAgICAgLy8gQ3VycmVudCBzY2hlbWFzIGtlZXAgY29udGVudF9iYXNlNjQgbnVsbGFibGUgYW5kIGF2b2lkIGR1cGxpY2F0aW5nXG4gICAgICAvLyBkcml2ZXItYmFja2VkIGNvbnRlbnQuIExlZ2FjeSBwYXRoIGlucHV0IHdhcyBtYXRlcmlhbGl6ZWQgb25jZSBiZWZvcmVcbiAgICAgIC8vIHRoZSBkcml2ZXIgd3JpdGUgc28gdGhpcyB2YWx1ZSBkZXNjcmliZXMgdGhvc2UgZXhhY3QgcGVyc2lzdGVkIGJ5dGVzLlxuICAgICAgY29uc3QgZGF0YWJhc2VDb250ZW50QmFzZTY0ID0gYXdhaXQgdGhpcy5kYXRhYmFzZUNvbnRlbnRCYXNlNjRGb3Iobm9ybWFsaXplZElucHV0KVxuXG4gICAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGlmIChyZXBsYWNlKSB7XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmdSb3dzID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgICAgICAgIC53aGVyZSh7bmFtZSwgcmVjb3JkX2lkOiByZWNvcmRJZCwgcmVjb3JkX3R5cGU6IHJlY29yZFR5cGV9KVxuICAgICAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAgICAgZm9yIChjb25zdCBleGlzdGluZ1JvdyBvZiBleGlzdGluZ1Jvd3MpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZGVsZXRlQXR0YWNobWVudFJvd1N0b3JhZ2Uoe21vZGVsLCBuYW1lLCByb3c6IGV4aXN0aW5nUm93fSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgICAgICAgY29uZGl0aW9uczoge25hbWUsIHJlY29yZF9pZDogcmVjb3JkSWQsIHJlY29yZF90eXBlOiByZWNvcmRUeXBlfSxcbiAgICAgICAgICAgIHRhYmxlTmFtZTogQVRUQUNITUVOVFNfVEFCTEVcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcG9zaXRpb24gPSByZXBsYWNlID8gMCA6IGF3YWl0IHRoaXMuX25leHRQb3NpdGlvbih7ZGIsIG5hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSlcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEluc2VydCBkYXRhLlxuICAgICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgICBjb25zdCBpbnNlcnREYXRhID0ge1xuICAgICAgICAgIGJ5dGVfc2l6ZTogbm9ybWFsaXplZElucHV0LmJ5dGVTaXplLFxuICAgICAgICAgIGNvbnRlbnRfYmFzZTY0OiBkYXRhYmFzZUNvbnRlbnRCYXNlNjQsXG4gICAgICAgICAgY29udGVudF90eXBlOiBub3JtYWxpemVkSW5wdXQuY29udGVudFR5cGUsXG4gICAgICAgICAgY3JlYXRlZF9hdF9tczogbm93LFxuICAgICAgICAgIGZpbGVuYW1lOiBub3JtYWxpemVkSW5wdXQuZmlsZW5hbWUsXG4gICAgICAgICAgaWQ6IGF0dGFjaG1lbnRJZCxcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIHBvc2l0aW9uLFxuICAgICAgICAgIHJlY29yZF9pZDogcmVjb3JkSWQsXG4gICAgICAgICAgcmVjb3JkX3R5cGU6IHJlY29yZFR5cGUsXG4gICAgICAgICAgdXBkYXRlZF9hdF9tczogbm93XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5fZHJpdmVyQ29sdW1uc0F2YWlsYWJsZSkge1xuICAgICAgICAgIGluc2VydERhdGEuZHJpdmVyID0gYXR0YWNobWVudERyaXZlck5hbWVcbiAgICAgICAgICBpbnNlcnREYXRhLnN0b3JhZ2Vfa2V5ID0gc3RvcmFnZUtleVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHtcbiAgICAgICAgICBkYXRhOiBpbnNlcnREYXRhLFxuICAgICAgICAgIHRhYmxlTmFtZTogQVRUQUNITUVOVFNfVEFCTEVcbiAgICAgICAgfSlcblxuICAgICAgICByb3dQZXJzaXN0ZWQgPSB0cnVlXG4gICAgICB9LCBtb2RlbClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFyb3dQZXJzaXN0ZWQgJiYgc3RvcmFnZUtleSAmJiB0eXBlb2YgYXR0YWNobWVudERyaXZlci5kZWxldGUgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGF0dGFjaG1lbnREcml2ZXIuZGVsZXRlKHtcbiAgICAgICAgICAgIG1vZGVsLFxuICAgICAgICAgICAgbmFtZSxcbiAgICAgICAgICAgIHJvdzoge2lkOiBhdHRhY2htZW50SWQsIHN0b3JhZ2Vfa2V5OiBzdG9yYWdlS2V5fSxcbiAgICAgICAgICAgIHN0b3JhZ2VLZXlcbiAgICAgICAgICB9KVxuICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbZXJyb3IsIGNsZWFudXBFcnJvcl0sXG4gICAgICAgICAgICBgQXR0YWNobWVudCB3cml0ZSBmaW5hbGl6YXRpb24gYW5kIG5ldy1zdG9yYWdlIGNsZWFudXAgYm90aCBmYWlsZWQgZm9yICR7cmVjb3JkVHlwZX0jJHtyZWNvcmRJZH0gKCR7bmFtZX0pYCxcbiAgICAgICAgICAgIHtjYXVzZTogY2xlYW51cEVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZGF0YWJhc2UgY29udGVudF9iYXNlNjQgdmFsdWUgZm9yIGN1cnJlbnQgYW5kIGxlZ2FjeSBzY2hlbWFzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbm9ybWFsaXplLWlucHV0LmpzXCIpLk5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXR9IG5vcm1hbGl6ZWRJbnB1dCAtIE5vcm1hbGl6ZWQgYXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gTnVsbGFibGUgb3IgbGVnYWN5IEJhc2U2NCBkYXRhYmFzZSB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIGRhdGFiYXNlQ29udGVudEJhc2U2NEZvcihub3JtYWxpemVkSW5wdXQpIHtcbiAgICBpZiAodGhpcy5fY29udGVudEJhc2U2NE51bGxhYmxlKSByZXR1cm4gbnVsbFxuICAgIGlmIChub3JtYWxpemVkSW5wdXQuY29udGVudEJhc2U2NCAhPT0gbnVsbCkgcmV0dXJuIG5vcm1hbGl6ZWRJbnB1dC5jb250ZW50QmFzZTY0XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJMZWdhY3kgYXR0YWNobWVudCBzY2hlbWEgcmVxdWlyZXMgbWF0ZXJpYWxpemVkIGNvbnRlbnQgYnl0ZXNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBhdHRhY2htZW50IHN0b3JlIHNjaGVtYS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gREIgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzY2hlbWEgY29sdW1ucyBhcmUgZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUF0dGFjaG1lbnRTdG9yZVNjaGVtYSh7ZGJ9KSB7XG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICBjb25zdCBjb2x1bW5zID0gYXdhaXQgdGFibGUuZ2V0Q29sdW1ucygpXG4gICAgY29uc3QgaGFzRHJpdmVyQ29sdW1uID0gY29sdW1ucy5zb21lKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT09IFwiZHJpdmVyXCIpXG4gICAgY29uc3QgaGFzU3RvcmFnZUtleUNvbHVtbiA9IGNvbHVtbnMuc29tZSgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09PSBcInN0b3JhZ2Vfa2V5XCIpXG4gICAgY29uc3QgY29udGVudEJhc2U2NENvbHVtbiA9IGNvbHVtbnMuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09PSBcImNvbnRlbnRfYmFzZTY0XCIpXG4gICAgY29uc3QgcmVjb3JkSWRDb2x1bW4gPSBjb2x1bW5zLmZpbmQoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSA9PT0gXCJyZWNvcmRfaWRcIilcbiAgICBjb25zdCBhbHRlclRhYmxlID0gbmV3IFRhYmxlRGF0YShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICBsZXQgc2hvdWxkQWx0ZXIgPSBmYWxzZVxuXG4gICAgaWYgKCFyZWNvcmRJZENvbHVtbikgdGhyb3cgbmV3IEVycm9yKGAke0FUVEFDSE1FTlRTX1RBQkxFfS5yZWNvcmRfaWQgaXMgbWlzc2luZ2ApXG5cbiAgICBjb25zdCByZWNvcmRJZE1heExlbmd0aCA9IHJlY29yZElkQ29sdW1uLmdldE1heExlbmd0aCgpXG5cbiAgICBpZiAodHlwZW9mIHJlY29yZElkTWF4TGVuZ3RoID09PSBcIm51bWJlclwiICYmIHJlY29yZElkTWF4TGVuZ3RoID4gMCkge1xuICAgICAgZm9yIChjb25zdCBpbmRleCBvZiBhd2FpdCByZWNvcmRJZENvbHVtbi5nZXRJbmRleGVzKCkpIHtcbiAgICAgICAgaWYgKGluZGV4LmlzUHJpbWFyeUtleSgpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IGluZGV4TmFtZSA9IGluZGV4LmdldE5hbWUoKVxuXG4gICAgICAgIGlmICghaW5kZXhOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGEgbmFtZSBmb3IgJHtBVFRBQ0hNRU5UU19UQUJMRX0ucmVjb3JkX2lkIGluZGV4YClcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5yZW1vdmVJbmRleFNRTHMoe25hbWU6IGluZGV4TmFtZSwgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRX0pKSB7XG4gICAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgcmVjb3JkSWRBbHRlclRhYmxlID0gbmV3IFRhYmxlRGF0YShBVFRBQ0hNRU5UU19UQUJMRSlcblxuICAgICAgcmVjb3JkSWRBbHRlclRhYmxlLnRleHQoXCJyZWNvcmRfaWRcIiwge1xuICAgICAgICBpc05ld0NvbHVtbjogZmFsc2UsXG4gICAgICAgIG51bGw6IGRiLmdldFR5cGUoKSA9PT0gXCJwZ3NxbFwiID8gdW5kZWZpbmVkIDogZmFsc2VcbiAgICAgIH0pXG5cbiAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHJlY29yZElkQWx0ZXJUYWJsZSkpIHtcbiAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9XG5cbiAgICBpZiAoIWhhc0RyaXZlckNvbHVtbikge1xuICAgICAgYWx0ZXJUYWJsZS5zdHJpbmcoXCJkcml2ZXJcIiwge251bGw6IHRydWV9KVxuICAgICAgc2hvdWxkQWx0ZXIgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCFoYXNTdG9yYWdlS2V5Q29sdW1uKSB7XG4gICAgICBhbHRlclRhYmxlLnN0cmluZyhcInN0b3JhZ2Vfa2V5XCIsIHtudWxsOiB0cnVlfSlcbiAgICAgIHNob3VsZEFsdGVyID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChzaG91bGRBbHRlcikge1xuICAgICAgY29uc3QgYWx0ZXJUYWJsZVNRTHMgPSBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyhhbHRlclRhYmxlKVxuXG4gICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhbHRlclRhYmxlU1FMcykge1xuICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH1cblxuICAgIHRoaXMuX2RyaXZlckNvbHVtbnNBdmFpbGFibGUgPSB0cnVlXG4gICAgdGhpcy5fY29udGVudEJhc2U2NE51bGxhYmxlID0gY29udGVudEJhc2U2NENvbHVtbiA/IGNvbnRlbnRCYXNlNjRDb2x1bW4uZ2V0TnVsbCgpIDogdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZCBhdHRhY2htZW50IHJvdy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mucm93IC0gQXR0YWNobWVudCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJ1ZmZlcj59IC0gQXR0YWNobWVudCBieXRlcy5cbiAgICovXG4gIGFzeW5jIHJlYWRBdHRhY2htZW50Um93KHttb2RlbCwgbmFtZSwgcm93fSkge1xuICAgIGlmICh0eXBlb2Ygcm93LmNvbnRlbnRfYmFzZTY0ID09PSBcInN0cmluZ1wiICYmIHJvdy5jb250ZW50X2Jhc2U2NC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gQnVmZmVyLmZyb20ocm93LmNvbnRlbnRfYmFzZTY0LCBcImJhc2U2NFwiKVxuICAgIH1cblxuICAgIGNvbnN0IHN0b3JhZ2VLZXkgPSB0eXBlb2Ygcm93LnN0b3JhZ2Vfa2V5ID09PSBcInN0cmluZ1wiICYmIHJvdy5zdG9yYWdlX2tleS5sZW5ndGggPiAwID8gcm93LnN0b3JhZ2Vfa2V5IDogbnVsbFxuXG4gICAgaWYgKCFzdG9yYWdlS2V5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgcm93ICR7U3RyaW5nKHJvdy5pZCl9IGlzIG1pc3Npbmcgc3RvcmFnZSBrZXlgKVxuICAgIH1cblxuICAgIGNvbnN0IGF0dGFjaG1lbnREcml2ZXIgPSBhd2FpdCB0aGlzLnJlc29sdmVBdHRhY2htZW50RHJpdmVyKHttb2RlbCwgbmFtZSwgcm93fSlcblxuICAgIHJldHVybiBhd2FpdCBhdHRhY2htZW50RHJpdmVyLnJlYWQoe1xuICAgICAgbW9kZWwsXG4gICAgICBuYW1lLFxuICAgICAgcm93LFxuICAgICAgc3RvcmFnZUtleVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IHJvdyB1cmwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJvdyAtIEF0dGFjaG1lbnQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBBdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGFzeW5jIGF0dGFjaG1lbnRSb3dVcmwoe21vZGVsLCBuYW1lLCByb3d9KSB7XG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lLCByb3d9KVxuXG4gICAgaWYgKHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLnVybCAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc3RvcmFnZUtleSA9IHR5cGVvZiByb3cuc3RvcmFnZV9rZXkgPT09IFwic3RyaW5nXCIgJiYgcm93LnN0b3JhZ2Vfa2V5Lmxlbmd0aCA+IDBcbiAgICAgID8gcm93LnN0b3JhZ2Vfa2V5XG4gICAgICA6ICh0eXBlb2Ygcm93LmlkID09PSBcInN0cmluZ1wiID8gcm93LmlkIDogXCJcIilcblxuICAgIGlmICghc3RvcmFnZUtleSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBhd2FpdCBhdHRhY2htZW50RHJpdmVyLnVybCh7XG4gICAgICBtb2RlbCxcbiAgICAgIG5hbWUsXG4gICAgICByb3csXG4gICAgICBzdG9yYWdlS2V5XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb25lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaWRdIC0gT3B0aW9uYWwgYXR0YWNobWVudCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gQXR0YWNobWVudCByb3cuXG4gICAqL1xuICBhc3luYyBmaW5kT25lKHtpZCwgbW9kZWwsIG5hbWV9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeShtb2RlbClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmRUeXBlID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG4gICAgICBjb25zdCByZWNvcmRJZCA9IGF0dGFjaG1lbnRSZWNvcmRJZChtb2RlbClcbiAgICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe25hbWUsIHJlY29yZF9pZDogcmVjb3JkSWQsIHJlY29yZF90eXBlOiByZWNvcmRUeXBlfSlcbiAgICAgICAgLm9yZGVyKFwicG9zaXRpb24gQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgREVTQ1wiKVxuICAgICAgICAubGltaXQoMSlcblxuICAgICAgaWYgKGlkKSB7XG4gICAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2lkfSlcbiAgICAgIH1cblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93c1swXSB8fCBudWxsXG4gICAgfSwgbW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG1hbnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSAtIEF0dGFjaG1lbnQgcm93cy5cbiAgICovXG4gIGFzeW5jIGZpbmRNYW55KHttb2RlbCwgbmFtZX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KG1vZGVsKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZFR5cGUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICAgIGNvbnN0IHJlY29yZElkID0gYXR0YWNobWVudFJlY29yZElkKG1vZGVsKVxuICAgICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtuYW1lLCByZWNvcmRfaWQ6IHJlY29yZElkLCByZWNvcmRfdHlwZTogcmVjb3JkVHlwZX0pXG4gICAgICAgIC5vcmRlcihcInBvc2l0aW9uIEFTQ1wiKVxuICAgICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuXG4gICAgICByZXR1cm4gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgfSwgbW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogTW92ZXMgZXZlcnkgYXR0YWNobWVudCByb3cgdG8gYSByZWNvcmQncyBuZXcgcHJpbWFyeS1rZXkgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5jb25uZWN0aW9uIC0gVHJhbnNhY3Rpb24tb3duaW5nIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIEF0dGFjaG1lbnQgb3duZXIgYWZ0ZXIgdGhlIGtleSBjaGFuZ2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGFyZ3MubmV4dElkZW50aXR5IC0gTmV3IG93bmVyIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBhcmdzLnByZXZpb3VzSWRlbnRpdHkgLSBQZXJzaXN0ZWQgb3duZXIgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIG93bmVyc2hpcCBpcyBtaWdyYXRlZC5cbiAgICovXG4gIGFzeW5jIG1pZ3JhdGVSZWNvcmRJZGVudGl0eSh7Y29ubmVjdGlvbiwgbW9kZWwsIG5leHRJZGVudGl0eSwgcHJldmlvdXNJZGVudGl0eX0pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IG5leHRSZWNvcmRJZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIG5leHRJZGVudGl0eSlcbiAgICBjb25zdCBwcmV2aW91c1JlY29yZElkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZGVudGl0eSlcblxuICAgIGlmIChuZXh0UmVjb3JkSWQgPT09IHByZXZpb3VzUmVjb3JkSWQpIHJldHVyblxuXG4gICAgaWYgKCFhd2FpdCBjb25uZWN0aW9uLnRhYmxlRXhpc3RzKEFUVEFDSE1FTlRTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBhd2FpdCBjb25uZWN0aW9uLnVwZGF0ZSh7XG4gICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgIHJlY29yZF9pZDogcHJldmlvdXNSZWNvcmRJZCxcbiAgICAgICAgcmVjb3JkX3R5cGU6IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgICAgfSxcbiAgICAgIGRhdGE6IHtyZWNvcmRfaWQ6IG5leHRSZWNvcmRJZH0sXG4gICAgICB0YWJsZU5hbWU6IEFUVEFDSE1FTlRTX1RBQkxFXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZSBhdHRhY2htZW50IHJvdyBzdG9yYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5yb3cgLSBBdHRhY2htZW50IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByb3cgc3RvcmFnZSBoYXMgYmVlbiBkZWxldGVkLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlQXR0YWNobWVudFJvd1N0b3JhZ2Uoe21vZGVsLCBuYW1lLCByb3d9KSB7XG4gICAgY29uc3Qgc3RvcmFnZUtleSA9IHR5cGVvZiByb3cuc3RvcmFnZV9rZXkgPT09IFwic3RyaW5nXCIgJiYgcm93LnN0b3JhZ2Vfa2V5Lmxlbmd0aCA+IDAgPyByb3cuc3RvcmFnZV9rZXkgOiBudWxsXG5cbiAgICBpZiAoIXN0b3JhZ2VLZXkpIHJldHVyblxuXG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lLCByb3d9KVxuXG4gICAgaWYgKHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLmRlbGV0ZSAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm5cblxuICAgIGF3YWl0IGF0dGFjaG1lbnREcml2ZXIuZGVsZXRlKHtcbiAgICAgIG1vZGVsLFxuICAgICAgbmFtZSxcbiAgICAgIHJvdyxcbiAgICAgIHN0b3JhZ2VLZXlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFB1cmdlcyBldmVyeSBhdHRhY2htZW50IHN0b3JlZCB1bmRlciAobW9kZWwsIG5hbWUpOiBkZWxldGVzIGVhY2ggcm93J3NcbiAgICogYmFja2luZyBzdG9yYWdlIGFuZCB0aGVuIHJlbW92ZXMgdGhlIGF0dGFjaG1lbnQgcm93cy4gVXNlZCB0byBjbGVhbiB1cCBhblxuICAgKiBvd25lciByZWNvcmQncyBhdHRhY2htZW50cyBiZWZvcmUvd2hlbiB0aGUgb3duZXIgaXMgZGVzdHJveWVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBhdHRhY2htZW50cyBwdXJnZWQuXG4gICAqL1xuICBhc3luYyBwdXJnZUFsbCh7bW9kZWwsIG5hbWV9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeShtb2RlbClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmRUeXBlID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG4gICAgICBjb25zdCByZWNvcmRJZCA9IGF0dGFjaG1lbnRSZWNvcmRJZChtb2RlbClcbiAgICAgIC8qKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtuYW1lLCByZWNvcmRfaWQ6IHJlY29yZElkLCByZWNvcmRfdHlwZTogcmVjb3JkVHlwZX0pXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgLy8gUmVmdXNlIHRvIHB1cmdlIHdoZW4gYW55IHJvdydzIGRyaXZlciBjYW5ub3QgZGVsZXRlIGl0cyBiYWNraW5nIHN0b3JhZ2U6XG4gICAgICAvLyByZW1vdmluZyB0aGUgcm93IHdoaWxlIHRoZSBvYmplY3Qgc3RheXMgYmVoaW5kIHdvdWxkIGxlYWsgc3RvcmFnZSBhbmRcbiAgICAgIC8vIGRpc2NhcmQgdGhlIG1ldGFkYXRhIG5lZWRlZCB0byByZXRyeSBjbGVhbnVwLiBGYWlsIGxvdWRseSBpbnN0ZWFkLlxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyID0gYXdhaXQgdGhpcy5yZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWUsIHJvd30pXG5cbiAgICAgICAgaWYgKHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLmRlbGV0ZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcHVyZ2UgYXR0YWNobWVudCAke3Jvdy5pZH0gZm9yICR7cmVjb3JkVHlwZX0jJHtyZWNvcmRJZH0gKCR7bmFtZX0pOiBpdHMgc3RvcmFnZSBkcml2ZXIgZG9lcyBub3Qgc3VwcG9ydCBkZWxldGlvbi5gKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVBdHRhY2htZW50Um93U3RvcmFnZSh7bW9kZWwsIG5hbWUsIHJvd30pXG4gICAgICAgIC8vIERlbGV0ZSBvbmx5IHRoZSBzbmFwc2hvdHRlZCByb3cgYnkgaWQsIHNvIGFuIGF0dGFjaG1lbnQgaW5zZXJ0ZWQgZm9yIHRoZVxuICAgICAgICAvLyBzYW1lIChyZWNvcmQsIG5hbWUpIGFmdGVyIHRoZSBzbmFwc2hvdCBpcyBub3QgcmVtb3ZlZCB3aXRoIGl0cyBzdG9yYWdlXG4gICAgICAgIC8vIHN0aWxsIHByZXNlbnQgKHdoaWNoIHdvdWxkIGxlYXZlIGl0IGFzIHVucmVhY2hhYmxlIHN0b3JhZ2UpLlxuICAgICAgICBhd2FpdCBkYi5kZWxldGUoe2NvbmRpdGlvbnM6IHtpZDogcm93LmlkfSwgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRX0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByb3dzLmxlbmd0aFxuICAgIH0sIG1vZGVsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkcml2ZXIgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRyaXZlck5hbWUgLSBEcml2ZXIgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBBdHRhY2htZW50IHN0b3JhZ2UgZHJpdmVyIGluc3RhbmNlLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNobWVudERyaXZlckJ5TmFtZShkcml2ZXJOYW1lKSB7XG4gICAgaWYgKHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlOYW1lLmhhcyhkcml2ZXJOYW1lKSkge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5fYXR0YWNobWVudERyaXZlcnNCeU5hbWUuZ2V0KGRyaXZlck5hbWUpKVxuICAgIH1cblxuICAgIGNvbnN0IGF0dGFjaG1lbnRDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbj8uKCkgfHwge31cbiAgICBjb25zdCBjb25maWd1cmVkRHJpdmVyID0gYXR0YWNobWVudENvbmZpZ3VyYXRpb24uZHJpdmVycz8uW2RyaXZlck5hbWVdXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBhdHRhY2htZW50RHJpdmVyLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgbGV0IGF0dGFjaG1lbnREcml2ZXJcblxuICAgIGlmICghY29uZmlndXJlZERyaXZlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBjb25maWd1cmVkIGF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgbmFtZWQgXCIke2RyaXZlck5hbWV9XCJgKVxuICAgIH0gZWxzZSBpZiAoY29uZmlndXJlZERyaXZlci5pbnN0YW5jZSAmJiB0eXBlb2YgY29uZmlndXJlZERyaXZlci5pbnN0YW5jZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgYXR0YWNobWVudERyaXZlciA9IGNvbmZpZ3VyZWREcml2ZXIuaW5zdGFuY2VcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb25maWd1cmVkRHJpdmVyLmRyaXZlckNsYXNzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBuZXcgY29uZmlndXJlZERyaXZlci5kcml2ZXJDbGFzcyh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgbmFtZTogZHJpdmVyTmFtZSxcbiAgICAgICAgb3B0aW9uczogY29uZmlndXJlZERyaXZlclxuICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb25maWd1cmVkRHJpdmVyLmNyZWF0ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhdHRhY2htZW50RHJpdmVyID0gY29uZmlndXJlZERyaXZlci5jcmVhdGUoe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgIG5hbWU6IGRyaXZlck5hbWUsXG4gICAgICAgIG9wdGlvbnM6IGNvbmZpZ3VyZWREcml2ZXJcbiAgICAgIH0pXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCBzdG9yYWdlIGRyaXZlciBcIiR7ZHJpdmVyTmFtZX1cIiBtdXN0IGRlZmluZSBpbnN0YW5jZSwgZHJpdmVyQ2xhc3MsIG9yIGNyZWF0ZWApXG4gICAgfVxuXG4gICAgaWYgKCFhdHRhY2htZW50RHJpdmVyIHx8IHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLndyaXRlICE9PSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIGF0dGFjaG1lbnREcml2ZXIucmVhZCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgXCIke2RyaXZlck5hbWV9XCIgbXVzdCBpbXBsZW1lbnQgd3JpdGUvcmVhZGApXG4gICAgfVxuXG4gICAgdGhpcy5fYXR0YWNobWVudERyaXZlcnNCeU5hbWUuc2V0KGRyaXZlck5hbWUsIGF0dGFjaG1lbnREcml2ZXIpXG5cbiAgICByZXR1cm4gYXR0YWNobWVudERyaXZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkcml2ZXIgYnkgcmVmZXJlbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7QXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmRyaXZlclJlZmVyZW5jZSAtIERyaXZlciBjbGFzcyBvciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEF0dGFjaG1lbnQgZHJpdmVyIGluc3RhbmNlLlxuICAgKi9cbiAgYXR0YWNobWVudERyaXZlckJ5UmVmZXJlbmNlKHthdHRhY2htZW50TmFtZSwgZHJpdmVyUmVmZXJlbmNlLCBtb2RlbENsYXNzfSkge1xuICAgIGlmICh0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5UmVmZXJlbmNlLmhhcyhkcml2ZXJSZWZlcmVuY2UpKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5UmVmZXJlbmNlLmdldChkcml2ZXJSZWZlcmVuY2UpKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlZmluZXMgYXR0YWNobWVudERyaXZlci5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGxldCBhdHRhY2htZW50RHJpdmVyXG5cbiAgICBpZiAodHlwZW9mIGRyaXZlclJlZmVyZW5jZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjb25zdCBEcml2ZXJDbGFzcyA9IC8qKiBAdHlwZSB7QXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yfSAqLyAoZHJpdmVyUmVmZXJlbmNlKVxuXG4gICAgICBhdHRhY2htZW50RHJpdmVyID0gbmV3IERyaXZlckNsYXNzKHtcbiAgICAgICAgYXR0YWNobWVudE5hbWUsXG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgbW9kZWxDbGFzc1xuICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKGRyaXZlclJlZmVyZW5jZSAmJiB0eXBlb2YgZHJpdmVyUmVmZXJlbmNlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBhdHRhY2htZW50RHJpdmVyID0gZHJpdmVyUmVmZXJlbmNlXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBhdHRhY2htZW50IGRyaXZlciByZWZlcmVuY2UgZm9yICR7bW9kZWxDbGFzcy5uYW1lfSMke2F0dGFjaG1lbnROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLndyaXRlICE9PSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIGF0dGFjaG1lbnREcml2ZXIucmVhZCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgZHJpdmVyIGZvciAke21vZGVsQ2xhc3MubmFtZX0jJHthdHRhY2htZW50TmFtZX0gbXVzdCBpbXBsZW1lbnQgd3JpdGUvcmVhZGApXG4gICAgfVxuXG4gICAgdGhpcy5fYXR0YWNobWVudERyaXZlcnNCeVJlZmVyZW5jZS5zZXQoZHJpdmVyUmVmZXJlbmNlLCBhdHRhY2htZW50RHJpdmVyKVxuXG4gICAgcmV0dXJuIGF0dGFjaG1lbnREcml2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgZHJpdmVyIG5hbWUgZm9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgZHJpdmVyIG5hbWUuXG4gICAqL1xuICBfYXR0YWNobWVudERyaXZlck5hbWVGb3Ioe21vZGVsLCBuYW1lfSkge1xuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldEF0dGFjaG1lbnRCeU5hbWUobmFtZSlcbiAgICBjb25zdCBjb25maWd1cmVkRHJpdmVyID0gYXR0YWNobWVudERlZmluaXRpb24uZHJpdmVyXG4gICAgY29uc3QgYXR0YWNobWVudHNDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbj8uKCkgfHwge31cbiAgICBjb25zdCBkZWZhdWx0RHJpdmVyID0gYXR0YWNobWVudHNDb25maWd1cmF0aW9uLmRlZmF1bHREcml2ZXJcblxuICAgIGlmICh0eXBlb2YgY29uZmlndXJlZERyaXZlciA9PT0gXCJzdHJpbmdcIiAmJiBjb25maWd1cmVkRHJpdmVyLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBjb25maWd1cmVkRHJpdmVyXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkRHJpdmVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBjb25maWd1cmVkRHJpdmVyLm5hbWUgfHwgXCJjdXN0b21cIlxuICAgIH1cblxuICAgIGlmIChjb25maWd1cmVkRHJpdmVyICYmIHR5cGVvZiBjb25maWd1cmVkRHJpdmVyID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBjb25zdCBjb25zdHJ1Y3Rvck5hbWUgPSBjb25maWd1cmVkRHJpdmVyLmNvbnN0cnVjdG9yPy5uYW1lXG5cbiAgICAgIGlmICh0eXBlb2YgY29uc3RydWN0b3JOYW1lID09PSBcInN0cmluZ1wiICYmIGNvbnN0cnVjdG9yTmFtZS5sZW5ndGggPiAwICYmIGNvbnN0cnVjdG9yTmFtZSAhPT0gXCJPYmplY3RcIikge1xuICAgICAgICByZXR1cm4gY29uc3RydWN0b3JOYW1lXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBcImN1c3RvbVwiXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBkZWZhdWx0RHJpdmVyID09PSBcInN0cmluZ1wiICYmIGRlZmF1bHREcml2ZXIubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGRlZmF1bHREcml2ZXJcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGF0dGFjaG1lbnQgZHJpdmVyIGNvbmZpZ3VyZWQgZm9yICR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IyR7bmFtZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBhdHRhY2htZW50IGRyaXZlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLnJvd10gLSBBdHRhY2htZW50IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBBdHRhY2htZW50IHN0b3JhZ2UgZHJpdmVyIGluc3RhbmNlLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lLCByb3d9KSB7XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0YWNobWVudEJ5TmFtZShuYW1lKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWREcml2ZXIgPSBhdHRhY2htZW50RGVmaW5pdGlvbi5kcml2ZXJcbiAgICBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIgPT09IFwiZnVuY3Rpb25cIiB8fCAoY29uZmlndXJlZERyaXZlciAmJiB0eXBlb2YgY29uZmlndXJlZERyaXZlciA9PT0gXCJvYmplY3RcIikpIHtcbiAgICAgIHJldHVybiB0aGlzLmF0dGFjaG1lbnREcml2ZXJCeVJlZmVyZW5jZSh7XG4gICAgICAgIGF0dGFjaG1lbnROYW1lOiBuYW1lLFxuICAgICAgICBkcml2ZXJSZWZlcmVuY2U6IGNvbmZpZ3VyZWREcml2ZXIsXG4gICAgICAgIG1vZGVsQ2xhc3M6IG1vZGVsLmdldE1vZGVsQ2xhc3MoKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCBmYWxsYmFja0RyaXZlck5hbWUgPSB0eXBlb2Ygcm93Py5kcml2ZXIgPT09IFwic3RyaW5nXCIgJiYgcm93LmRyaXZlci5sZW5ndGggPiAwXG4gICAgICA/IHJvdy5kcml2ZXJcbiAgICAgIDogdGhpcy5fYXR0YWNobWVudERyaXZlck5hbWVGb3Ioe21vZGVsLCBuYW1lfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmF0dGFjaG1lbnREcml2ZXJCeU5hbWUoZmFsbGJhY2tEcml2ZXJOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBwb3NpdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gREIgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVjb3JkSWQgLSBSZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlY29yZFR5cGUgLSBSZWNvcmQgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBOZXh0IHBvc2l0aW9uLlxuICAgKi9cbiAgYXN5bmMgX25leHRQb3NpdGlvbih7ZGIsIG5hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgIC53aGVyZSh7bmFtZSwgcmVjb3JkX2lkOiByZWNvcmRJZCwgcmVjb3JkX3R5cGU6IHJlY29yZFR5cGV9KVxuICAgICAgLm9yZGVyKFwicG9zaXRpb24gREVTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgIGNvbnN0IGN1cnJlbnRSb3cgPSAvKiogQHR5cGUge3twb3NpdGlvbj86IHN0cmluZyB8IG51bWJlciB8IG51bGx9IHwgdW5kZWZpbmVkfSAqLyAocm93c1swXSlcbiAgICBjb25zdCBjdXJyZW50ID0gTnVtYmVyKGN1cnJlbnRSb3c/LnBvc2l0aW9uKVxuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoY3VycmVudCkpIHJldHVybiAwXG5cbiAgICByZXR1cm4gY3VycmVudCArIDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggZGIuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBbbW9kZWxdIC0gT3BlcmF0aW9uLW93bmluZyBtb2RlbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhEYihjYWxsYmFjaywgbW9kZWwpIHtcbiAgICBpZiAobW9kZWwgJiYgbW9kZWwuZGF0YWJhc2VPcGVyYXRpb24oKSkgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG1vZGVsLmNvbm5lY3Rpb24oKSlcblxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIC8qKlxuICAgICAqIERlZmluZXMgcmVzdWx0LlxuICAgICAqIEB0eXBlIHtUIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCByZXN1bHRcblxuICAgIGF3YWl0IHBvb2wud2l0aENvbm5lY3Rpb24oe25hbWU6IFwiUmVjb3JkIGF0dGFjaG1lbnQgc3RvcmVcIn0sIGFzeW5jIChkYikgPT4ge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgfSlcblxuICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovIChyZXN1bHQpXG4gIH1cbn1cbiJdfQ==