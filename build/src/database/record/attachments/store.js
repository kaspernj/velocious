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
        table.string("record_id", { null: false, index: true });
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
        const alterTable = new TableData(ATTACHMENTS_TABLE);
        let shouldAlter = false;
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
     * @param {import("../index.js").default} args.model - Attachment owner after the key change.
     * @param {import("../../../utils/model-primary-key.js").ModelPrimaryKeyValue} args.nextIdentity - New owner identity.
     * @param {import("../../../utils/model-primary-key.js").ModelPrimaryKeyValue} args.previousIdentity - Persisted owner identity.
     * @returns {Promise<void>} - Resolves after ownership is migrated.
     */
    async migrateRecordIdentity({ model, nextIdentity, previousIdentity }) {
        const primaryKey = model.getModelClass().primaryKey();
        const nextRecordId = modelPrimaryKeyCacheKey(primaryKey, nextIdentity);
        const previousRecordId = modelPrimaryKeyCacheKey(primaryKey, previousIdentity);
        if (nextRecordId === previousRecordId)
            return;
        await this._withDb(async (db) => {
            if (!await db.tableExists(ATTACHMENTS_TABLE))
                return;
            await db.update({
                conditions: {
                    record_id: previousRecordId,
                    record_type: model.getModelClass().getModelName()
                },
                data: { record_id: nextRecordId },
                tableName: ATTACHMENTS_TABLE
            });
        }, model);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F0dGFjaG1lbnRzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMkJBQTJCLENBQUE7QUFDakQsT0FBTyxFQUFDLHVCQUF1QixFQUFDLE1BQU0scUNBQXFDLENBQUE7QUFDM0UsT0FBTyw4QkFBOEIsTUFBTSxzQkFBc0IsQ0FBQTtBQUVqRTs7a0hBRWtIO0FBQ2xILE1BQU0saUJBQWlCLEdBQUcsdUJBQXVCLENBQUE7QUFFakQ7O3VHQUV1RztBQUN2RyxNQUFNLHFCQUFxQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFM0M7OztHQUdHO0FBQ0gsU0FBUyxZQUFZO0lBQ25CLE9BQU8sSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUE7QUFDN0IsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGtCQUFrQixDQUFDLEtBQUs7SUFDL0IsT0FBTyx1QkFBdUIsQ0FBQyxLQUFLLENBQUMsYUFBYSxFQUFFLENBQUMsVUFBVSxFQUFFLEVBQUUsS0FBSyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUE7QUFDaEYsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGdCQUFnQixDQUFDLEtBQUs7SUFDN0IsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixFQUFFLENBQUE7SUFFM0MsSUFBSSxTQUFTO1FBQUUsT0FBTyxTQUFTLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtJQUVsRCxPQUFPLEdBQUcsS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFDLHFCQUFxQixFQUFFLEVBQUUsQ0FBQTtBQUMzRCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSw4QkFBOEIsQ0FBQyxLQUFLO0lB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RSxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDbkQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxhQUFhLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3ZELEtBQUssQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUNyRCxLQUFLLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDaEQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUN4QyxLQUFLLENBQUMsTUFBTSxDQUFDLFVBQVUsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQ3ZDLEtBQUssQ0FBQyxNQUFNLENBQUMsY0FBYyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDMUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUN4QyxLQUFLLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3BDLEtBQUssQ0FBQyxNQUFNLENBQUMsYUFBYSxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDekMsS0FBSyxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzFDLEtBQUssQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLEVBQUMs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QUFFLE9BQU8sQ0FBQyxDQUFBO1FBRXZDLE9BQU8sT0FBTyxHQUFHLENBQUMsQ0FBQTtJQUNwQixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsS0FBSztRQUMzQixJQUFJLEtBQUssSUFBSSxLQUFLLENBQUMsaUJBQWlCLEVBQUU7WUFBRSxPQUFPLE1BQU0sUUFBUSxDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFBO1FBRWpGLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBQ3hFOzttQ0FFMkI7UUFDM0IsSUFBSSxNQUFNLENBQUE7UUFFVixNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxJQUFJLEVBQUUseUJBQXlCLEVBQUMsRUFBRSxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDeEUsTUFBTSxHQUFHLE1BQU0sUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzdCLENBQUMsQ0FBQyxDQUFBO1FBRUYsT0FBTyxnQkFBZ0IsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ2xDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDYWNoZUtleX0gZnJvbSBcIi4uLy4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCBub3JtYWxpemVSZWNvcmRBdHRhY2htZW50SW5wdXQgZnJvbSBcIi4vbm9ybWFsaXplLWlucHV0LmpzXCJcblxuLyoqXG4gKiBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi8uLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3Rvcn0gQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yICovXG5jb25zdCBBVFRBQ0hNRU5UU19UQUJMRSA9IFwidmVsb2Npb3VzX2F0dGFjaG1lbnRzXCJcblxuLyoqXG4gKiBTdG9yZXMgYnkgY29uZmlndXJhdGlvbi5cbiAqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4uLy4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgTWFwPHN0cmluZywgUmVjb3JkQXR0YWNobWVudHNTdG9yZT4+fSAqL1xuY29uc3Qgc3RvcmVzQnlDb25maWd1cmF0aW9uID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIFJ1bnMgZ2VuZXJhdGUgdXVpZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gR2VuZXJhdGVkIFVVSUQgdjQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlVVVJRCgpIHtcbiAgcmV0dXJuIG5ldyBVVUlEKDQpLmZvcm1hdCgpXG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgY2Fub25pY2FsIHN0b3JlZCBvd25lciBpZGVudGl0eSBmb3IgYSBtb2RlbCBhdHRhY2htZW50LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEF0dGFjaG1lbnQgb3duZXIuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIENhbm9uaWNhbCBvd25lciBpZGVudGl0eS5cbiAqL1xuZnVuY3Rpb24gYXR0YWNobWVudFJlY29yZElkKG1vZGVsKSB7XG4gIHJldHVybiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShtb2RlbC5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpLCBtb2RlbC5pZCgpKVxufVxuXG4vKipcbiAqIFJ1bnMgc3RvcmUga2V5IGZvciBtb2RlbC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RvcmUga2V5LlxuICovXG5mdW5jdGlvbiBzdG9yZUtleUZvck1vZGVsKG1vZGVsKSB7XG4gIGNvbnN0IG9wZXJhdGlvbiA9IG1vZGVsLmRhdGFiYXNlT3BlcmF0aW9uKClcblxuICBpZiAob3BlcmF0aW9uKSByZXR1cm4gb3BlcmF0aW9uLmRhdGFiYXNlSWRlbnRpdHkoKVxuXG4gIHJldHVybiBgJHttb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCl9YFxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIHJlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbCBoZWxwZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7UmVjb3JkQXR0YWNobWVudHNTdG9yZX0gLSBTdG9yZSBpbnN0YW5jZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbChtb2RlbCkge1xuICBjb25zdCBjb25maWd1cmF0aW9uID0gbW9kZWwuX2dldENvbmZpZ3VyYXRpb24oKVxuICBsZXQgc3RvcmVzQnlEYXRhYmFzZUlkZW50aWZpZXIgPSBzdG9yZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgaWYgKCFzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllcikge1xuICAgIHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyID0gbmV3IE1hcCgpXG4gICAgc3RvcmVzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllcilcbiAgfVxuXG4gIGNvbnN0IGtleSA9IHN0b3JlS2V5Rm9yTW9kZWwobW9kZWwpXG4gIGxldCBzdG9yZSA9IHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyLmdldChrZXkpXG5cbiAgaWYgKHN0b3JlKSByZXR1cm4gc3RvcmVcblxuICBzdG9yZSA9IG5ldyBSZWNvcmRBdHRhY2htZW50c1N0b3JlKHtcbiAgICBjb25maWd1cmF0aW9uLFxuICAgIGRhdGFiYXNlSWRlbnRpZmllcjogbW9kZWwuZGF0YWJhc2VPcGVyYXRpb24oKT8uZGF0YWJhc2VJZGVudGlmaWVyKCkgfHwgbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gIH0pXG5cbiAgc3RvcmVzQnlEYXRhYmFzZUlkZW50aWZpZXIuc2V0KGtleSwgc3RvcmUpXG5cbiAgcmV0dXJuIHN0b3JlXG59XG5cbi8qKlxuICogQXR0YWNobWVudCBwZXJzaXN0ZW5jZSBzdG9yZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgUmVjb3JkQXR0YWNobWVudHNTdG9yZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZUlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcn0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgdGhpcy5fZHJpdmVyQ29sdW1uc0F2YWlsYWJsZSA9IGZhbHNlXG4gICAgdGhpcy5fY29udGVudEJhc2U2NE51bGxhYmxlID0gdHJ1ZVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5TmFtZSA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5UmVmZXJlbmNlID0gbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgcmVhZHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gW21vZGVsXSAtIE9wZXJhdGlvbi1vd25pbmcgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2NoZW1hIGlzIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkobW9kZWwpIHtcbiAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlKSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuZW5zdXJlU2NoZW1hKGRiKVxuICAgICAgfSwgbW9kZWwpXG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYXR0YWNobWVudCBzY2hlbWEgdGhyb3VnaCBhbiBhbHJlYWR5LW93bmVkIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzY2hlbWEgaXMgcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVTY2hlbWEoZGIpIHtcbiAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcblxuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhBVFRBQ0hNRU5UU19UQUJMRSkpIHtcbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlQXR0YWNobWVudFN0b3JlU2NoZW1hKHtkYn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoQVRUQUNITUVOVFNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJpZFwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInJlY29yZF90eXBlXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInJlY29yZF9pZFwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJuYW1lXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJwb3NpdGlvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImZpbGVuYW1lXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29udGVudF90eXBlXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJieXRlX3NpemVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJkcml2ZXJcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInN0b3JhZ2Vfa2V5XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwiY29udGVudF9iYXNlNjRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJ1cGRhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICB0aGlzLl9kcml2ZXJDb2x1bW5zQXZhaWxhYmxlID0gdHJ1ZVxuICAgIHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5pbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5yZXBsYWNlIC0gV2hldGhlciB0byByZXBsYWNlIGV4aXN0aW5nIGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNoKHtpbnB1dCwgbW9kZWwsIG5hbWUsIHJlcGxhY2V9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeShtb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uPy4oKSB8fCB7fVxuICAgIGNvbnN0IGFsbG93UGF0aElucHV0ID0gYXR0YWNobWVudHNDb25maWd1cmF0aW9uLmFsbG93UGF0aElucHV0ID09PSB0cnVlXG4gICAgY29uc3QgYWxsb3dlZFBhdGhQcmVmaXhlcyA9IEFycmF5LmlzQXJyYXkoYXR0YWNobWVudHNDb25maWd1cmF0aW9uLmFsbG93ZWRQYXRoUHJlZml4ZXMpXG4gICAgICA/IGF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbi5hbGxvd2VkUGF0aFByZWZpeGVzXG4gICAgICA6IHVuZGVmaW5lZFxuXG4gICAgY29uc3Qgbm9ybWFsaXplZElucHV0ID0gYXdhaXQgbm9ybWFsaXplUmVjb3JkQXR0YWNobWVudElucHV0KGlucHV0LCB7XG4gICAgICBhbGxvd1BhdGhJbnB1dCxcbiAgICAgIGFsbG93ZWRQYXRoUHJlZml4ZXMsXG4gICAgICBlbnZpcm9ubWVudEhhbmRsZXI6IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIH0pXG4gICAgLyoqXG4gICAgICogQXR0YWNobWVudCBwZXJzaXN0ZW5jZSBlcnJvci5cbiAgICAgKiBUaGlzIHN0YXlzIG9wYXF1ZSBzbyBhbnkgSmF2YVNjcmlwdCB0aHJvd24gdmFsdWUgaXMgcHJlc2VydmVkIGV4YWN0bHkuXG4gICAgICogQHR5cGUge3Vua25vd259ICovXG4gICAgbGV0IHBlcnNpc3RlbmNlRXJyb3IgPSBudWxsXG4gICAgbGV0IHBlcnNpc3RlbmNlRmFpbGVkID0gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwZXJzaXN0ZW5jZUlucHV0ID0gYXdhaXQgdGhpcy5wZXJzaXN0ZW5jZUlucHV0Rm9yKG5vcm1hbGl6ZWRJbnB1dClcblxuICAgICAgYXdhaXQgdGhpcy5wZXJzaXN0Tm9ybWFsaXplZEF0dGFjaG1lbnQoe1xuICAgICAgICBtb2RlbCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgbm9ybWFsaXplZElucHV0OiBwZXJzaXN0ZW5jZUlucHV0LFxuICAgICAgICByZXBsYWNlXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBwZXJzaXN0ZW5jZUZhaWxlZCA9IHRydWVcbiAgICAgIHBlcnNpc3RlbmNlRXJyb3IgPSBlcnJvclxuICAgIH1cblxuICAgIGlmIChub3JtYWxpemVkSW5wdXQucGF0aFNvdXJjZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgbm9ybWFsaXplZElucHV0LnBhdGhTb3VyY2UuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICBpZiAocGVyc2lzdGVuY2VGYWlsZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbcGVyc2lzdGVuY2VFcnJvciwgY2xvc2VFcnJvcl0sXG4gICAgICAgICAgICBgQXR0YWNobWVudCBwZXJzaXN0ZW5jZSBhbmQgcGF0aC1zb3VyY2UgY2xvc2UgYm90aCBmYWlsZWQgZm9yICR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpfSMke2F0dGFjaG1lbnRSZWNvcmRJZChtb2RlbCl9ICgke25hbWV9KWAsXG4gICAgICAgICAgICB7Y2F1c2U6IGNsb3NlRXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgY2xvc2VFcnJvclxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwZXJzaXN0ZW5jZUZhaWxlZCkgdGhyb3cgcGVyc2lzdGVuY2VFcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIE1hdGVyaWFsaXplcyBwYXRoIGNvbnRlbnQgb25jZSB3aGVuIGEgbGVnYWN5IHNjaGVtYSByZXF1aXJlcyBCYXNlNjQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dH0gbm9ybWFsaXplZElucHV0IC0gTm9ybWFsaXplZCBhdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL25vcm1hbGl6ZS1pbnB1dC5qc1wiKS5Ob3JtYWxpemVkQXR0YWNobWVudElucHV0Pn0gLSBJbnB1dCB1c2VkIGJ5IHRoZSBkcml2ZXIgYW5kIGRhdGFiYXNlLlxuICAgKi9cbiAgYXN5bmMgcGVyc2lzdGVuY2VJbnB1dEZvcihub3JtYWxpemVkSW5wdXQpIHtcbiAgICBpZiAodGhpcy5fY29udGVudEJhc2U2NE51bGxhYmxlIHx8ICFub3JtYWxpemVkSW5wdXQucGF0aFNvdXJjZSkgcmV0dXJuIG5vcm1hbGl6ZWRJbnB1dFxuXG4gICAgY29uc3QgY29udGVudEJ1ZmZlciA9IGF3YWl0IG5vcm1hbGl6ZWRJbnB1dC5wYXRoU291cmNlLnJlYWRCdWZmZXIoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLm5vcm1hbGl6ZWRJbnB1dCxcbiAgICAgIGNvbnRlbnRCYXNlNjQ6IGNvbnRlbnRCdWZmZXIudG9TdHJpbmcoXCJiYXNlNjRcIiksXG4gICAgICBjb250ZW50QnVmZmVyLFxuICAgICAgcGF0aFNvdXJjZTogbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBvbmUgbm9ybWFsaXplZCBhdHRhY2htZW50IHdoaWxlIGl0cyBwYXRoIHNvdXJjZSByZW1haW5zIG9wZW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dH0gYXJncy5ub3JtYWxpemVkSW5wdXQgLSBOb3JtYWxpemVkIGF0dGFjaG1lbnQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5yZXBsYWNlIC0gV2hldGhlciB0byByZXBsYWNlIGV4aXN0aW5nIGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHBlcnNpc3ROb3JtYWxpemVkQXR0YWNobWVudCh7bW9kZWwsIG5hbWUsIG5vcm1hbGl6ZWRJbnB1dCwgcmVwbGFjZX0pIHtcbiAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyID0gYXdhaXQgdGhpcy5yZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWV9KVxuICAgIGNvbnN0IGF0dGFjaG1lbnREcml2ZXJOYW1lID0gdGhpcy5fYXR0YWNobWVudERyaXZlck5hbWVGb3Ioe21vZGVsLCBuYW1lfSlcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpXG4gICAgY29uc3QgcmVjb3JkVHlwZSA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIGNvbnN0IHJlY29yZElkID0gYXR0YWNobWVudFJlY29yZElkKG1vZGVsKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRJZCA9IGdlbmVyYXRlVVVJRCgpXG4gICAgLyoqXG4gICAgICogV3JpdHRlbiBzdG9yYWdlIGtleS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgICBsZXQgc3RvcmFnZUtleSA9IG51bGxcbiAgICBsZXQgcm93UGVyc2lzdGVkID0gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCB3cml0ZVJlc3VsdCA9IGF3YWl0IGF0dGFjaG1lbnREcml2ZXIud3JpdGUoe1xuICAgICAgICBhdHRhY2htZW50SWQsXG4gICAgICAgIGlucHV0OiBub3JtYWxpemVkSW5wdXQsXG4gICAgICAgIG1vZGVsLFxuICAgICAgICBuYW1lXG4gICAgICB9KVxuXG4gICAgICBzdG9yYWdlS2V5ID0gd3JpdGVSZXN1bHQuc3RvcmFnZUtleVxuXG4gICAgICAvLyBDdXJyZW50IHNjaGVtYXMga2VlcCBjb250ZW50X2Jhc2U2NCBudWxsYWJsZSBhbmQgYXZvaWQgZHVwbGljYXRpbmdcbiAgICAgIC8vIGRyaXZlci1iYWNrZWQgY29udGVudC4gTGVnYWN5IHBhdGggaW5wdXQgd2FzIG1hdGVyaWFsaXplZCBvbmNlIGJlZm9yZVxuICAgICAgLy8gdGhlIGRyaXZlciB3cml0ZSBzbyB0aGlzIHZhbHVlIGRlc2NyaWJlcyB0aG9zZSBleGFjdCBwZXJzaXN0ZWQgYnl0ZXMuXG4gICAgICBjb25zdCBkYXRhYmFzZUNvbnRlbnRCYXNlNjQgPSBhd2FpdCB0aGlzLmRhdGFiYXNlQ29udGVudEJhc2U2NEZvcihub3JtYWxpemVkSW5wdXQpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgICAgaWYgKHJlcGxhY2UpIHtcbiAgICAgICAgICBjb25zdCBleGlzdGluZ1Jvd3MgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAgICAgLndoZXJlKHtuYW1lLCByZWNvcmRfaWQ6IHJlY29yZElkLCByZWNvcmRfdHlwZTogcmVjb3JkVHlwZX0pXG4gICAgICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGV4aXN0aW5nUm93IG9mIGV4aXN0aW5nUm93cykge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVBdHRhY2htZW50Um93U3RvcmFnZSh7bW9kZWwsIG5hbWUsIHJvdzogZXhpc3RpbmdSb3d9KVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICAgICAgICBjb25kaXRpb25zOiB7bmFtZSwgcmVjb3JkX2lkOiByZWNvcmRJZCwgcmVjb3JkX3R5cGU6IHJlY29yZFR5cGV9LFxuICAgICAgICAgICAgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwb3NpdGlvbiA9IHJlcGxhY2UgPyAwIDogYXdhaXQgdGhpcy5fbmV4dFBvc2l0aW9uKHtkYiwgbmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KVxuICAgICAgICAvKipcbiAgICAgICAgICogSW5zZXJ0IGRhdGEuXG4gICAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICAgIGNvbnN0IGluc2VydERhdGEgPSB7XG4gICAgICAgICAgYnl0ZV9zaXplOiBub3JtYWxpemVkSW5wdXQuYnl0ZVNpemUsXG4gICAgICAgICAgY29udGVudF9iYXNlNjQ6IGRhdGFiYXNlQ29udGVudEJhc2U2NCxcbiAgICAgICAgICBjb250ZW50X3R5cGU6IG5vcm1hbGl6ZWRJbnB1dC5jb250ZW50VHlwZSxcbiAgICAgICAgICBjcmVhdGVkX2F0X21zOiBub3csXG4gICAgICAgICAgZmlsZW5hbWU6IG5vcm1hbGl6ZWRJbnB1dC5maWxlbmFtZSxcbiAgICAgICAgICBpZDogYXR0YWNobWVudElkLFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgcG9zaXRpb24sXG4gICAgICAgICAgcmVjb3JkX2lkOiByZWNvcmRJZCxcbiAgICAgICAgICByZWNvcmRfdHlwZTogcmVjb3JkVHlwZSxcbiAgICAgICAgICB1cGRhdGVkX2F0X21zOiBub3dcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLl9kcml2ZXJDb2x1bW5zQXZhaWxhYmxlKSB7XG4gICAgICAgICAgaW5zZXJ0RGF0YS5kcml2ZXIgPSBhdHRhY2htZW50RHJpdmVyTmFtZVxuICAgICAgICAgIGluc2VydERhdGEuc3RvcmFnZV9rZXkgPSBzdG9yYWdlS2V5XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgICAgIGRhdGE6IGluc2VydERhdGEsXG4gICAgICAgICAgdGFibGVOYW1lOiBBVFRBQ0hNRU5UU19UQUJMRVxuICAgICAgICB9KVxuXG4gICAgICAgIHJvd1BlcnNpc3RlZCA9IHRydWVcbiAgICAgIH0sIG1vZGVsKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIXJvd1BlcnNpc3RlZCAmJiBzdG9yYWdlS2V5ICYmIHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLmRlbGV0ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgYXR0YWNobWVudERyaXZlci5kZWxldGUoe1xuICAgICAgICAgICAgbW9kZWwsXG4gICAgICAgICAgICBuYW1lLFxuICAgICAgICAgICAgcm93OiB7aWQ6IGF0dGFjaG1lbnRJZCwgc3RvcmFnZV9rZXk6IHN0b3JhZ2VLZXl9LFxuICAgICAgICAgICAgc3RvcmFnZUtleVxuICAgICAgICAgIH0pXG4gICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xuICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtlcnJvciwgY2xlYW51cEVycm9yXSxcbiAgICAgICAgICAgIGBBdHRhY2htZW50IHdyaXRlIGZpbmFsaXphdGlvbiBhbmQgbmV3LXN0b3JhZ2UgY2xlYW51cCBib3RoIGZhaWxlZCBmb3IgJHtyZWNvcmRUeXBlfSMke3JlY29yZElkfSAoJHtuYW1lfSlgLFxuICAgICAgICAgICAge2NhdXNlOiBjbGVhbnVwRXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBkYXRhYmFzZSBjb250ZW50X2Jhc2U2NCB2YWx1ZSBmb3IgY3VycmVudCBhbmQgbGVnYWN5IHNjaGVtYXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dH0gbm9ybWFsaXplZElucHV0IC0gTm9ybWFsaXplZCBhdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBOdWxsYWJsZSBvciBsZWdhY3kgQmFzZTY0IGRhdGFiYXNlIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgZGF0YWJhc2VDb250ZW50QmFzZTY0Rm9yKG5vcm1hbGl6ZWRJbnB1dCkge1xuICAgIGlmICh0aGlzLl9jb250ZW50QmFzZTY0TnVsbGFibGUpIHJldHVybiBudWxsXG4gICAgaWYgKG5vcm1hbGl6ZWRJbnB1dC5jb250ZW50QmFzZTY0ICE9PSBudWxsKSByZXR1cm4gbm9ybWFsaXplZElucHV0LmNvbnRlbnRCYXNlNjRcblxuICAgIHRocm93IG5ldyBFcnJvcihcIkxlZ2FjeSBhdHRhY2htZW50IHNjaGVtYSByZXF1aXJlcyBtYXRlcmlhbGl6ZWQgY29udGVudCBieXRlc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGF0dGFjaG1lbnQgc3RvcmUgc2NoZW1hLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEQiBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNjaGVtYSBjb2x1bW5zIGFyZSBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQXR0YWNobWVudFN0b3JlU2NoZW1hKHtkYn0pIHtcbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgIGNvbnN0IGNvbHVtbnMgPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5zKClcbiAgICBjb25zdCBoYXNEcml2ZXJDb2x1bW4gPSBjb2x1bW5zLnNvbWUoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSA9PT0gXCJkcml2ZXJcIilcbiAgICBjb25zdCBoYXNTdG9yYWdlS2V5Q29sdW1uID0gY29sdW1ucy5zb21lKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT09IFwic3RvcmFnZV9rZXlcIilcbiAgICBjb25zdCBjb250ZW50QmFzZTY0Q29sdW1uID0gY29sdW1ucy5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT09IFwiY29udGVudF9iYXNlNjRcIilcbiAgICBjb25zdCBhbHRlclRhYmxlID0gbmV3IFRhYmxlRGF0YShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICBsZXQgc2hvdWxkQWx0ZXIgPSBmYWxzZVxuXG4gICAgaWYgKCFoYXNEcml2ZXJDb2x1bW4pIHtcbiAgICAgIGFsdGVyVGFibGUuc3RyaW5nKFwiZHJpdmVyXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgIHNob3VsZEFsdGVyID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmICghaGFzU3RvcmFnZUtleUNvbHVtbikge1xuICAgICAgYWx0ZXJUYWJsZS5zdHJpbmcoXCJzdG9yYWdlX2tleVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICBzaG91bGRBbHRlciA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkQWx0ZXIpIHtcbiAgICAgIGNvbnN0IGFsdGVyVGFibGVTUUxzID0gYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHMoYWx0ZXJUYWJsZSlcblxuICAgICAgZm9yIChjb25zdCBzcWwgb2YgYWx0ZXJUYWJsZVNRTHMpIHtcbiAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2RyaXZlckNvbHVtbnNBdmFpbGFibGUgPSB0cnVlXG4gICAgdGhpcy5fY29udGVudEJhc2U2NE51bGxhYmxlID0gY29udGVudEJhc2U2NENvbHVtbiA/IGNvbnRlbnRCYXNlNjRDb2x1bW4uZ2V0TnVsbCgpIDogdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZCBhdHRhY2htZW50IHJvdy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mucm93IC0gQXR0YWNobWVudCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJ1ZmZlcj59IC0gQXR0YWNobWVudCBieXRlcy5cbiAgICovXG4gIGFzeW5jIHJlYWRBdHRhY2htZW50Um93KHttb2RlbCwgbmFtZSwgcm93fSkge1xuICAgIGlmICh0eXBlb2Ygcm93LmNvbnRlbnRfYmFzZTY0ID09PSBcInN0cmluZ1wiICYmIHJvdy5jb250ZW50X2Jhc2U2NC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gQnVmZmVyLmZyb20ocm93LmNvbnRlbnRfYmFzZTY0LCBcImJhc2U2NFwiKVxuICAgIH1cblxuICAgIGNvbnN0IHN0b3JhZ2VLZXkgPSB0eXBlb2Ygcm93LnN0b3JhZ2Vfa2V5ID09PSBcInN0cmluZ1wiICYmIHJvdy5zdG9yYWdlX2tleS5sZW5ndGggPiAwID8gcm93LnN0b3JhZ2Vfa2V5IDogbnVsbFxuXG4gICAgaWYgKCFzdG9yYWdlS2V5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgcm93ICR7U3RyaW5nKHJvdy5pZCl9IGlzIG1pc3Npbmcgc3RvcmFnZSBrZXlgKVxuICAgIH1cblxuICAgIGNvbnN0IGF0dGFjaG1lbnREcml2ZXIgPSBhd2FpdCB0aGlzLnJlc29sdmVBdHRhY2htZW50RHJpdmVyKHttb2RlbCwgbmFtZSwgcm93fSlcblxuICAgIHJldHVybiBhd2FpdCBhdHRhY2htZW50RHJpdmVyLnJlYWQoe1xuICAgICAgbW9kZWwsXG4gICAgICBuYW1lLFxuICAgICAgcm93LFxuICAgICAgc3RvcmFnZUtleVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IHJvdyB1cmwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJvdyAtIEF0dGFjaG1lbnQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBBdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGFzeW5jIGF0dGFjaG1lbnRSb3dVcmwoe21vZGVsLCBuYW1lLCByb3d9KSB7XG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lLCByb3d9KVxuXG4gICAgaWYgKHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLnVybCAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc3RvcmFnZUtleSA9IHR5cGVvZiByb3cuc3RvcmFnZV9rZXkgPT09IFwic3RyaW5nXCIgJiYgcm93LnN0b3JhZ2Vfa2V5Lmxlbmd0aCA+IDBcbiAgICAgID8gcm93LnN0b3JhZ2Vfa2V5XG4gICAgICA6ICh0eXBlb2Ygcm93LmlkID09PSBcInN0cmluZ1wiID8gcm93LmlkIDogXCJcIilcblxuICAgIGlmICghc3RvcmFnZUtleSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBhd2FpdCBhdHRhY2htZW50RHJpdmVyLnVybCh7XG4gICAgICBtb2RlbCxcbiAgICAgIG5hbWUsXG4gICAgICByb3csXG4gICAgICBzdG9yYWdlS2V5XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb25lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaWRdIC0gT3B0aW9uYWwgYXR0YWNobWVudCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gQXR0YWNobWVudCByb3cuXG4gICAqL1xuICBhc3luYyBmaW5kT25lKHtpZCwgbW9kZWwsIG5hbWV9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeShtb2RlbClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmRUeXBlID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG4gICAgICBjb25zdCByZWNvcmRJZCA9IGF0dGFjaG1lbnRSZWNvcmRJZChtb2RlbClcbiAgICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe25hbWUsIHJlY29yZF9pZDogcmVjb3JkSWQsIHJlY29yZF90eXBlOiByZWNvcmRUeXBlfSlcbiAgICAgICAgLm9yZGVyKFwicG9zaXRpb24gQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgREVTQ1wiKVxuICAgICAgICAubGltaXQoMSlcblxuICAgICAgaWYgKGlkKSB7XG4gICAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2lkfSlcbiAgICAgIH1cblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93c1swXSB8fCBudWxsXG4gICAgfSwgbW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG1hbnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSAtIEF0dGFjaG1lbnQgcm93cy5cbiAgICovXG4gIGFzeW5jIGZpbmRNYW55KHttb2RlbCwgbmFtZX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KG1vZGVsKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZFR5cGUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICAgIGNvbnN0IHJlY29yZElkID0gYXR0YWNobWVudFJlY29yZElkKG1vZGVsKVxuICAgICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtuYW1lLCByZWNvcmRfaWQ6IHJlY29yZElkLCByZWNvcmRfdHlwZTogcmVjb3JkVHlwZX0pXG4gICAgICAgIC5vcmRlcihcInBvc2l0aW9uIEFTQ1wiKVxuICAgICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuXG4gICAgICByZXR1cm4gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgfSwgbW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogTW92ZXMgZXZlcnkgYXR0YWNobWVudCByb3cgdG8gYSByZWNvcmQncyBuZXcgcHJpbWFyeS1rZXkgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gQXR0YWNobWVudCBvd25lciBhZnRlciB0aGUga2V5IGNoYW5nZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gYXJncy5uZXh0SWRlbnRpdHkgLSBOZXcgb3duZXIgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGFyZ3MucHJldmlvdXNJZGVudGl0eSAtIFBlcnNpc3RlZCBvd25lciBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgb3duZXJzaGlwIGlzIG1pZ3JhdGVkLlxuICAgKi9cbiAgYXN5bmMgbWlncmF0ZVJlY29yZElkZW50aXR5KHttb2RlbCwgbmV4dElkZW50aXR5LCBwcmV2aW91c0lkZW50aXR5fSkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gICAgY29uc3QgbmV4dFJlY29yZElkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgbmV4dElkZW50aXR5KVxuICAgIGNvbnN0IHByZXZpb3VzUmVjb3JkSWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuXG4gICAgaWYgKG5leHRSZWNvcmRJZCA9PT0gcHJldmlvdXNSZWNvcmRJZCkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBpZiAoIWF3YWl0IGRiLnRhYmxlRXhpc3RzKEFUVEFDSE1FTlRTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICByZWNvcmRfaWQ6IHByZXZpb3VzUmVjb3JkSWQsXG4gICAgICAgICAgcmVjb3JkX3R5cGU6IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgICAgICB9LFxuICAgICAgICBkYXRhOiB7cmVjb3JkX2lkOiBuZXh0UmVjb3JkSWR9LFxuICAgICAgICB0YWJsZU5hbWU6IEFUVEFDSE1FTlRTX1RBQkxFXG4gICAgICB9KVxuICAgIH0sIG1vZGVsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsZXRlIGF0dGFjaG1lbnQgcm93IHN0b3JhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJvdyAtIEF0dGFjaG1lbnQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJvdyBzdG9yYWdlIGhhcyBiZWVuIGRlbGV0ZWQuXG4gICAqL1xuICBhc3luYyBkZWxldGVBdHRhY2htZW50Um93U3RvcmFnZSh7bW9kZWwsIG5hbWUsIHJvd30pIHtcbiAgICBjb25zdCBzdG9yYWdlS2V5ID0gdHlwZW9mIHJvdy5zdG9yYWdlX2tleSA9PT0gXCJzdHJpbmdcIiAmJiByb3cuc3RvcmFnZV9rZXkubGVuZ3RoID4gMCA/IHJvdy5zdG9yYWdlX2tleSA6IG51bGxcblxuICAgIGlmICghc3RvcmFnZUtleSkgcmV0dXJuXG5cbiAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyID0gYXdhaXQgdGhpcy5yZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWUsIHJvd30pXG5cbiAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnREcml2ZXIuZGVsZXRlICE9PSBcImZ1bmN0aW9uXCIpIHJldHVyblxuXG4gICAgYXdhaXQgYXR0YWNobWVudERyaXZlci5kZWxldGUoe1xuICAgICAgbW9kZWwsXG4gICAgICBuYW1lLFxuICAgICAgcm93LFxuICAgICAgc3RvcmFnZUtleVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUHVyZ2VzIGV2ZXJ5IGF0dGFjaG1lbnQgc3RvcmVkIHVuZGVyIChtb2RlbCwgbmFtZSk6IGRlbGV0ZXMgZWFjaCByb3cnc1xuICAgKiBiYWNraW5nIHN0b3JhZ2UgYW5kIHRoZW4gcmVtb3ZlcyB0aGUgYXR0YWNobWVudCByb3dzLiBVc2VkIHRvIGNsZWFuIHVwIGFuXG4gICAqIG93bmVyIHJlY29yZCdzIGF0dGFjaG1lbnRzIGJlZm9yZS93aGVuIHRoZSBvd25lciBpcyBkZXN0cm95ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIGF0dGFjaG1lbnRzIHB1cmdlZC5cbiAgICovXG4gIGFzeW5jIHB1cmdlQWxsKHttb2RlbCwgbmFtZX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KG1vZGVsKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZFR5cGUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICAgIGNvbnN0IHJlY29yZElkID0gYXR0YWNobWVudFJlY29yZElkKG1vZGVsKVxuICAgICAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe25hbWUsIHJlY29yZF9pZDogcmVjb3JkSWQsIHJlY29yZF90eXBlOiByZWNvcmRUeXBlfSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAvLyBSZWZ1c2UgdG8gcHVyZ2Ugd2hlbiBhbnkgcm93J3MgZHJpdmVyIGNhbm5vdCBkZWxldGUgaXRzIGJhY2tpbmcgc3RvcmFnZTpcbiAgICAgIC8vIHJlbW92aW5nIHRoZSByb3cgd2hpbGUgdGhlIG9iamVjdCBzdGF5cyBiZWhpbmQgd291bGQgbGVhayBzdG9yYWdlIGFuZFxuICAgICAgLy8gZGlzY2FyZCB0aGUgbWV0YWRhdGEgbmVlZGVkIHRvIHJldHJ5IGNsZWFudXAuIEZhaWwgbG91ZGx5IGluc3RlYWQuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IGF0dGFjaG1lbnREcml2ZXIgPSBhd2FpdCB0aGlzLnJlc29sdmVBdHRhY2htZW50RHJpdmVyKHttb2RlbCwgbmFtZSwgcm93fSlcblxuICAgICAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnREcml2ZXIuZGVsZXRlICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBwdXJnZSBhdHRhY2htZW50ICR7cm93LmlkfSBmb3IgJHtyZWNvcmRUeXBlfSMke3JlY29yZElkfSAoJHtuYW1lfSk6IGl0cyBzdG9yYWdlIGRyaXZlciBkb2VzIG5vdCBzdXBwb3J0IGRlbGV0aW9uLmApXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZUF0dGFjaG1lbnRSb3dTdG9yYWdlKHttb2RlbCwgbmFtZSwgcm93fSlcbiAgICAgICAgLy8gRGVsZXRlIG9ubHkgdGhlIHNuYXBzaG90dGVkIHJvdyBieSBpZCwgc28gYW4gYXR0YWNobWVudCBpbnNlcnRlZCBmb3IgdGhlXG4gICAgICAgIC8vIHNhbWUgKHJlY29yZCwgbmFtZSkgYWZ0ZXIgdGhlIHNuYXBzaG90IGlzIG5vdCByZW1vdmVkIHdpdGggaXRzIHN0b3JhZ2VcbiAgICAgICAgLy8gc3RpbGwgcHJlc2VudCAod2hpY2ggd291bGQgbGVhdmUgaXQgYXMgdW5yZWFjaGFibGUgc3RvcmFnZSkuXG4gICAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7Y29uZGl0aW9uczoge2lkOiByb3cuaWR9LCB0YWJsZU5hbWU6IEFUVEFDSE1FTlRTX1RBQkxFfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJvd3MubGVuZ3RoXG4gICAgfSwgbW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRyaXZlciBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZHJpdmVyTmFtZSAtIERyaXZlciBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgaW5zdGFuY2UuXG4gICAqL1xuICBhc3luYyBhdHRhY2htZW50RHJpdmVyQnlOYW1lKGRyaXZlck5hbWUpIHtcbiAgICBpZiAodGhpcy5fYXR0YWNobWVudERyaXZlcnNCeU5hbWUuaGFzKGRyaXZlck5hbWUpKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5TmFtZS5nZXQoZHJpdmVyTmFtZSkpXG4gICAgfVxuXG4gICAgY29uc3QgYXR0YWNobWVudENvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uPy4oKSB8fCB7fVxuICAgIGNvbnN0IGNvbmZpZ3VyZWREcml2ZXIgPSBhdHRhY2htZW50Q29uZmlndXJhdGlvbi5kcml2ZXJzPy5bZHJpdmVyTmFtZV1cbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGF0dGFjaG1lbnREcml2ZXIuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBsZXQgYXR0YWNobWVudERyaXZlclxuXG4gICAgaWYgKCFjb25maWd1cmVkRHJpdmVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbmZpZ3VyZWQgYXR0YWNobWVudCBzdG9yYWdlIGRyaXZlciBuYW1lZCBcIiR7ZHJpdmVyTmFtZX1cImApXG4gICAgfSBlbHNlIGlmIChjb25maWd1cmVkRHJpdmVyLmluc3RhbmNlICYmIHR5cGVvZiBjb25maWd1cmVkRHJpdmVyLmluc3RhbmNlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBhdHRhY2htZW50RHJpdmVyID0gY29uZmlndXJlZERyaXZlci5pbnN0YW5jZVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIuZHJpdmVyQ2xhc3MgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXR0YWNobWVudERyaXZlciA9IG5ldyBjb25maWd1cmVkRHJpdmVyLmRyaXZlckNsYXNzKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBuYW1lOiBkcml2ZXJOYW1lLFxuICAgICAgICBvcHRpb25zOiBjb25maWd1cmVkRHJpdmVyXG4gICAgICB9KVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIuY3JlYXRlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBjb25maWd1cmVkRHJpdmVyLmNyZWF0ZSh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgbmFtZTogZHJpdmVyTmFtZSxcbiAgICAgICAgb3B0aW9uczogY29uZmlndXJlZERyaXZlclxuICAgICAgfSlcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50IHN0b3JhZ2UgZHJpdmVyIFwiJHtkcml2ZXJOYW1lfVwiIG11c3QgZGVmaW5lIGluc3RhbmNlLCBkcml2ZXJDbGFzcywgb3IgY3JlYXRlYClcbiAgICB9XG5cbiAgICBpZiAoIWF0dGFjaG1lbnREcml2ZXIgfHwgdHlwZW9mIGF0dGFjaG1lbnREcml2ZXIud3JpdGUgIT09IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgYXR0YWNobWVudERyaXZlci5yZWFkICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCBzdG9yYWdlIGRyaXZlciBcIiR7ZHJpdmVyTmFtZX1cIiBtdXN0IGltcGxlbWVudCB3cml0ZS9yZWFkYClcbiAgICB9XG5cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5TmFtZS5zZXQoZHJpdmVyTmFtZSwgYXR0YWNobWVudERyaXZlcilcblxuICAgIHJldHVybiBhdHRhY2htZW50RHJpdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRyaXZlciBieSByZWZlcmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuZHJpdmVyUmVmZXJlbmNlIC0gRHJpdmVyIGNsYXNzIG9yIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQXR0YWNobWVudCBkcml2ZXIgaW5zdGFuY2UuXG4gICAqL1xuICBhdHRhY2htZW50RHJpdmVyQnlSZWZlcmVuY2Uoe2F0dGFjaG1lbnROYW1lLCBkcml2ZXJSZWZlcmVuY2UsIG1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlSZWZlcmVuY2UuaGFzKGRyaXZlclJlZmVyZW5jZSkpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlSZWZlcmVuY2UuZ2V0KGRyaXZlclJlZmVyZW5jZSkpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBhdHRhY2htZW50RHJpdmVyLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgbGV0IGF0dGFjaG1lbnREcml2ZXJcblxuICAgIGlmICh0eXBlb2YgZHJpdmVyUmVmZXJlbmNlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGNvbnN0IERyaXZlckNsYXNzID0gLyoqIEB0eXBlIHtBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3J9ICovIChkcml2ZXJSZWZlcmVuY2UpXG5cbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBuZXcgRHJpdmVyQ2xhc3Moe1xuICAgICAgICBhdHRhY2htZW50TmFtZSxcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBtb2RlbENsYXNzXG4gICAgICB9KVxuICAgIH0gZWxzZSBpZiAoZHJpdmVyUmVmZXJlbmNlICYmIHR5cGVvZiBkcml2ZXJSZWZlcmVuY2UgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBkcml2ZXJSZWZlcmVuY2VcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGF0dGFjaG1lbnQgZHJpdmVyIHJlZmVyZW5jZSBmb3IgJHttb2RlbENsYXNzLm5hbWV9IyR7YXR0YWNobWVudE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnREcml2ZXIud3JpdGUgIT09IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgYXR0YWNobWVudERyaXZlci5yZWFkICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCBkcml2ZXIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfSMke2F0dGFjaG1lbnROYW1lfSBtdXN0IGltcGxlbWVudCB3cml0ZS9yZWFkYClcbiAgICB9XG5cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5UmVmZXJlbmNlLnNldChkcml2ZXJSZWZlcmVuY2UsIGF0dGFjaG1lbnREcml2ZXIpXG5cbiAgICByZXR1cm4gYXR0YWNobWVudERyaXZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkcml2ZXIgbmFtZSBmb3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBkcml2ZXIgbmFtZS5cbiAgICovXG4gIF9hdHRhY2htZW50RHJpdmVyTmFtZUZvcih7bW9kZWwsIG5hbWV9KSB7XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0YWNobWVudEJ5TmFtZShuYW1lKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWREcml2ZXIgPSBhdHRhY2htZW50RGVmaW5pdGlvbi5kcml2ZXJcbiAgICBjb25zdCBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uPy4oKSB8fCB7fVxuICAgIGNvbnN0IGRlZmF1bHREcml2ZXIgPSBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24uZGVmYXVsdERyaXZlclxuXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkRHJpdmVyID09PSBcInN0cmluZ1wiICYmIGNvbmZpZ3VyZWREcml2ZXIubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGNvbmZpZ3VyZWREcml2ZXJcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIGNvbmZpZ3VyZWREcml2ZXIubmFtZSB8fCBcImN1c3RvbVwiXG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZ3VyZWREcml2ZXIgJiYgdHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGNvbnN0IGNvbnN0cnVjdG9yTmFtZSA9IGNvbmZpZ3VyZWREcml2ZXIuY29uc3RydWN0b3I/Lm5hbWVcblxuICAgICAgaWYgKHR5cGVvZiBjb25zdHJ1Y3Rvck5hbWUgPT09IFwic3RyaW5nXCIgJiYgY29uc3RydWN0b3JOYW1lLmxlbmd0aCA+IDAgJiYgY29uc3RydWN0b3JOYW1lICE9PSBcIk9iamVjdFwiKSB7XG4gICAgICAgIHJldHVybiBjb25zdHJ1Y3Rvck5hbWVcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIFwiY3VzdG9tXCJcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRlZmF1bHREcml2ZXIgPT09IFwic3RyaW5nXCIgJiYgZGVmYXVsdERyaXZlci5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gZGVmYXVsdERyaXZlclxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgTm8gYXR0YWNobWVudCBkcml2ZXIgY29uZmlndXJlZCBmb3IgJHttb2RlbC5nZXRNb2RlbENsYXNzKCkubmFtZX0jJHtuYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGF0dGFjaG1lbnQgZHJpdmVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3Mucm93XSAtIEF0dGFjaG1lbnQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgaW5zdGFuY2UuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWUsIHJvd30pIHtcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRhY2htZW50QnlOYW1lKG5hbWUpXG4gICAgY29uc3QgY29uZmlndXJlZERyaXZlciA9IGF0dGFjaG1lbnREZWZpbml0aW9uLmRyaXZlclxuICAgIGlmICh0eXBlb2YgY29uZmlndXJlZERyaXZlciA9PT0gXCJmdW5jdGlvblwiIHx8IChjb25maWd1cmVkRHJpdmVyICYmIHR5cGVvZiBjb25maWd1cmVkRHJpdmVyID09PSBcIm9iamVjdFwiKSkge1xuICAgICAgcmV0dXJuIHRoaXMuYXR0YWNobWVudERyaXZlckJ5UmVmZXJlbmNlKHtcbiAgICAgICAgYXR0YWNobWVudE5hbWU6IG5hbWUsXG4gICAgICAgIGRyaXZlclJlZmVyZW5jZTogY29uZmlndXJlZERyaXZlcixcbiAgICAgICAgbW9kZWxDbGFzczogbW9kZWwuZ2V0TW9kZWxDbGFzcygpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IGZhbGxiYWNrRHJpdmVyTmFtZSA9IHR5cGVvZiByb3c/LmRyaXZlciA9PT0gXCJzdHJpbmdcIiAmJiByb3cuZHJpdmVyLmxlbmd0aCA+IDBcbiAgICAgID8gcm93LmRyaXZlclxuICAgICAgOiB0aGlzLl9hdHRhY2htZW50RHJpdmVyTmFtZUZvcih7bW9kZWwsIG5hbWV9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuYXR0YWNobWVudERyaXZlckJ5TmFtZShmYWxsYmFja0RyaXZlck5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IHBvc2l0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEQiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWNvcmRJZCAtIFJlY29yZCBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVjb3JkVHlwZSAtIFJlY29yZCB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE5leHQgcG9zaXRpb24uXG4gICAqL1xuICBhc3luYyBfbmV4dFBvc2l0aW9uKHtkYiwgbmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KSB7XG4gICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgLndoZXJlKHtuYW1lLCByZWNvcmRfaWQ6IHJlY29yZElkLCByZWNvcmRfdHlwZTogcmVjb3JkVHlwZX0pXG4gICAgICAub3JkZXIoXCJwb3NpdGlvbiBERVNDXCIpXG4gICAgICAubGltaXQoMSlcbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgY29uc3QgY3VycmVudFJvdyA9IC8qKiBAdHlwZSB7e3Bvc2l0aW9uPzogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gfCB1bmRlZmluZWR9ICovIChyb3dzWzBdKVxuICAgIGNvbnN0IGN1cnJlbnQgPSBOdW1iZXIoY3VycmVudFJvdz8ucG9zaXRpb24pXG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShjdXJyZW50KSkgcmV0dXJuIDBcblxuICAgIHJldHVybiBjdXJyZW50ICsgMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkYi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IFttb2RlbF0gLSBPcGVyYXRpb24tb3duaW5nIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aERiKGNhbGxiYWNrLCBtb2RlbCkge1xuICAgIGlmIChtb2RlbCAmJiBtb2RlbC5kYXRhYmFzZU9wZXJhdGlvbigpKSByZXR1cm4gYXdhaXQgY2FsbGJhY2sobW9kZWwuY29ubmVjdGlvbigpKVxuXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2wodGhpcy5kYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyByZXN1bHQuXG4gICAgICogQHR5cGUge1QgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHJlc3VsdFxuXG4gICAgYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJSZWNvcmQgYXR0YWNobWVudCBzdG9yZVwifSwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXN1bHQgPSBhd2FpdCBjYWxsYmFjayhkYilcbiAgICB9KVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHJlc3VsdClcbiAgfVxufVxuIl19