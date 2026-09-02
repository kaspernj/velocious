// @ts-check
import UUID from "pure-uuid";
import TableData from "../../table-data/index.js";
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
                    throw new AggregateError([persistenceError, closeError], `Attachment persistence and path-source close both failed for ${model.getModelClass().getModelName()}#${String(model.id())} (${name})`, { cause: closeError });
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
        const recordId = String(model.id());
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
            const recordId = String(model.id());
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
            const recordId = String(model.id());
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
            const recordId = String(model.id());
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F0dGFjaG1lbnRzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMkJBQTJCLENBQUE7QUFDakQsT0FBTyw4QkFBOEIsTUFBTSxzQkFBc0IsQ0FBQTtBQUVqRTs7a0hBRWtIO0FBQ2xILE1BQU0saUJBQWlCLEdBQUcsdUJBQXVCLENBQUE7QUFFakQ7O3VHQUV1RztBQUN2RyxNQUFNLHFCQUFxQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFM0M7OztHQUdHO0FBQ0gsU0FBUyxZQUFZO0lBQ25CLE9BQU8sSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUE7QUFDN0IsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGdCQUFnQixDQUFDLEtBQUs7SUFDN0IsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixFQUFFLENBQUE7SUFFM0MsSUFBSSxTQUFTO1FBQUUsT0FBTyxTQUFTLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtJQUVsRCxPQUFPLEdBQUcsS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFDLHFCQUFxQixFQUFFLEVBQUUsQ0FBQTtBQUMzRCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSw4QkFBOEIsQ0FBQyxLQUFLO0lBQ2xELE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO0lBQy9DLElBQUksMEJBQTBCLEdBQUcscUJBQXFCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFBO0lBRXpFLElBQUksQ0FBQywwQkFBMEIsRUFBRSxDQUFDO1FBQ2hDLDBCQUEwQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDdEMscUJBQXFC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QUFBO1FBQzNGLE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDLENBQUE7UUFFNUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDO1lBQUUsT0FBTyxDQUFDLENBQUE7UUFFdkMsT0FBTyxPQUFPLEdBQUcsQ0FBQyxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxLQUFLO1FBQzNCLElBQUksS0FBSyxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsRUFBRTtZQUFFLE9BQU8sTUFBTSxRQUFRLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUE7UUFFakYsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUE7UUFDeEU7O21DQUUyQjtRQUMzQixJQUFJLE1BQU0sQ0FBQTtRQUVWLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBQyxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUN4RSxNQUFNLEdBQUcsTUFBTSxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDN0IsQ0FBQyxDQUFDLENBQUE7UUFFRixPQUFPLGdCQUFnQixDQUFDLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDbEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgbm9ybWFsaXplUmVjb3JkQXR0YWNobWVudElucHV0IGZyb20gXCIuL25vcm1hbGl6ZS1pbnB1dC5qc1wiXG5cbi8qKlxuICogQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3J9IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciAqL1xuY29uc3QgQVRUQUNITUVOVFNfVEFCTEUgPSBcInZlbG9jaW91c19hdHRhY2htZW50c1wiXG5cbi8qKlxuICogU3RvcmVzIGJ5IGNvbmZpZ3VyYXRpb24uXG4gKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi8uLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRzU3RvcmU+Pn0gKi9cbmNvbnN0IHN0b3Jlc0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBSdW5zIGdlbmVyYXRlIHV1aWQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEdlbmVyYXRlZCBVVUlEIHY0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVVVSUQoKSB7XG4gIHJldHVybiBuZXcgVVVJRCg0KS5mb3JtYXQoKVxufVxuXG4vKipcbiAqIFJ1bnMgc3RvcmUga2V5IGZvciBtb2RlbC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RvcmUga2V5LlxuICovXG5mdW5jdGlvbiBzdG9yZUtleUZvck1vZGVsKG1vZGVsKSB7XG4gIGNvbnN0IG9wZXJhdGlvbiA9IG1vZGVsLmRhdGFiYXNlT3BlcmF0aW9uKClcblxuICBpZiAob3BlcmF0aW9uKSByZXR1cm4gb3BlcmF0aW9uLmRhdGFiYXNlSWRlbnRpdHkoKVxuXG4gIHJldHVybiBgJHttb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCl9YFxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIHJlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbCBoZWxwZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7UmVjb3JkQXR0YWNobWVudHNTdG9yZX0gLSBTdG9yZSBpbnN0YW5jZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbChtb2RlbCkge1xuICBjb25zdCBjb25maWd1cmF0aW9uID0gbW9kZWwuX2dldENvbmZpZ3VyYXRpb24oKVxuICBsZXQgc3RvcmVzQnlEYXRhYmFzZUlkZW50aWZpZXIgPSBzdG9yZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgaWYgKCFzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllcikge1xuICAgIHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyID0gbmV3IE1hcCgpXG4gICAgc3RvcmVzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBzdG9yZXNCeURhdGFiYXNlSWRlbnRpZmllcilcbiAgfVxuXG4gIGNvbnN0IGtleSA9IHN0b3JlS2V5Rm9yTW9kZWwobW9kZWwpXG4gIGxldCBzdG9yZSA9IHN0b3Jlc0J5RGF0YWJhc2VJZGVudGlmaWVyLmdldChrZXkpXG5cbiAgaWYgKHN0b3JlKSByZXR1cm4gc3RvcmVcblxuICBzdG9yZSA9IG5ldyBSZWNvcmRBdHRhY2htZW50c1N0b3JlKHtcbiAgICBjb25maWd1cmF0aW9uLFxuICAgIGRhdGFiYXNlSWRlbnRpZmllcjogbW9kZWwuZGF0YWJhc2VPcGVyYXRpb24oKT8uZGF0YWJhc2VJZGVudGlmaWVyKCkgfHwgbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gIH0pXG5cbiAgc3RvcmVzQnlEYXRhYmFzZUlkZW50aWZpZXIuc2V0KGtleSwgc3RvcmUpXG5cbiAgcmV0dXJuIHN0b3JlXG59XG5cbi8qKlxuICogQXR0YWNobWVudCBwZXJzaXN0ZW5jZSBzdG9yZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgUmVjb3JkQXR0YWNobWVudHNTdG9yZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZUlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcn0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgdGhpcy5fZHJpdmVyQ29sdW1uc0F2YWlsYWJsZSA9IGZhbHNlXG4gICAgdGhpcy5fY29udGVudEJhc2U2NE51bGxhYmxlID0gdHJ1ZVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5TmFtZSA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5UmVmZXJlbmNlID0gbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgcmVhZHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gW21vZGVsXSAtIE9wZXJhdGlvbi1vd25pbmcgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2NoZW1hIGlzIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkobW9kZWwpIHtcbiAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlKSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuZW5zdXJlU2NoZW1hKGRiKVxuICAgICAgfSwgbW9kZWwpXG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYXR0YWNobWVudCBzY2hlbWEgdGhyb3VnaCBhbiBhbHJlYWR5LW93bmVkIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzY2hlbWEgaXMgcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVTY2hlbWEoZGIpIHtcbiAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcblxuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhBVFRBQ0hNRU5UU19UQUJMRSkpIHtcbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlQXR0YWNobWVudFN0b3JlU2NoZW1hKHtkYn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoQVRUQUNITUVOVFNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJpZFwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInJlY29yZF90eXBlXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInJlY29yZF9pZFwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJuYW1lXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJwb3NpdGlvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImZpbGVuYW1lXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29udGVudF90eXBlXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJieXRlX3NpemVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJkcml2ZXJcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInN0b3JhZ2Vfa2V5XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwiY29udGVudF9iYXNlNjRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJ1cGRhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICB0aGlzLl9kcml2ZXJDb2x1bW5zQXZhaWxhYmxlID0gdHJ1ZVxuICAgIHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5pbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5yZXBsYWNlIC0gV2hldGhlciB0byByZXBsYWNlIGV4aXN0aW5nIGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNoKHtpbnB1dCwgbW9kZWwsIG5hbWUsIHJlcGxhY2V9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeShtb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uPy4oKSB8fCB7fVxuICAgIGNvbnN0IGFsbG93UGF0aElucHV0ID0gYXR0YWNobWVudHNDb25maWd1cmF0aW9uLmFsbG93UGF0aElucHV0ID09PSB0cnVlXG4gICAgY29uc3QgYWxsb3dlZFBhdGhQcmVmaXhlcyA9IEFycmF5LmlzQXJyYXkoYXR0YWNobWVudHNDb25maWd1cmF0aW9uLmFsbG93ZWRQYXRoUHJlZml4ZXMpXG4gICAgICA/IGF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbi5hbGxvd2VkUGF0aFByZWZpeGVzXG4gICAgICA6IHVuZGVmaW5lZFxuXG4gICAgY29uc3Qgbm9ybWFsaXplZElucHV0ID0gYXdhaXQgbm9ybWFsaXplUmVjb3JkQXR0YWNobWVudElucHV0KGlucHV0LCB7XG4gICAgICBhbGxvd1BhdGhJbnB1dCxcbiAgICAgIGFsbG93ZWRQYXRoUHJlZml4ZXMsXG4gICAgICBlbnZpcm9ubWVudEhhbmRsZXI6IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIH0pXG4gICAgLyoqXG4gICAgICogQXR0YWNobWVudCBwZXJzaXN0ZW5jZSBlcnJvci5cbiAgICAgKiBUaGlzIHN0YXlzIG9wYXF1ZSBzbyBhbnkgSmF2YVNjcmlwdCB0aHJvd24gdmFsdWUgaXMgcHJlc2VydmVkIGV4YWN0bHkuXG4gICAgICogQHR5cGUge3Vua25vd259ICovXG4gICAgbGV0IHBlcnNpc3RlbmNlRXJyb3IgPSBudWxsXG4gICAgbGV0IHBlcnNpc3RlbmNlRmFpbGVkID0gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwZXJzaXN0ZW5jZUlucHV0ID0gYXdhaXQgdGhpcy5wZXJzaXN0ZW5jZUlucHV0Rm9yKG5vcm1hbGl6ZWRJbnB1dClcblxuICAgICAgYXdhaXQgdGhpcy5wZXJzaXN0Tm9ybWFsaXplZEF0dGFjaG1lbnQoe1xuICAgICAgICBtb2RlbCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgbm9ybWFsaXplZElucHV0OiBwZXJzaXN0ZW5jZUlucHV0LFxuICAgICAgICByZXBsYWNlXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBwZXJzaXN0ZW5jZUZhaWxlZCA9IHRydWVcbiAgICAgIHBlcnNpc3RlbmNlRXJyb3IgPSBlcnJvclxuICAgIH1cblxuICAgIGlmIChub3JtYWxpemVkSW5wdXQucGF0aFNvdXJjZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgbm9ybWFsaXplZElucHV0LnBhdGhTb3VyY2UuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICBpZiAocGVyc2lzdGVuY2VGYWlsZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbcGVyc2lzdGVuY2VFcnJvciwgY2xvc2VFcnJvcl0sXG4gICAgICAgICAgICBgQXR0YWNobWVudCBwZXJzaXN0ZW5jZSBhbmQgcGF0aC1zb3VyY2UgY2xvc2UgYm90aCBmYWlsZWQgZm9yICR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpfSMke1N0cmluZyhtb2RlbC5pZCgpKX0gKCR7bmFtZX0pYCxcbiAgICAgICAgICAgIHtjYXVzZTogY2xvc2VFcnJvcn1cbiAgICAgICAgICApXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBjbG9zZUVycm9yXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHBlcnNpc3RlbmNlRmFpbGVkKSB0aHJvdyBwZXJzaXN0ZW5jZUVycm9yXG4gIH1cblxuICAvKipcbiAgICogTWF0ZXJpYWxpemVzIHBhdGggY29udGVudCBvbmNlIHdoZW4gYSBsZWdhY3kgc2NoZW1hIHJlcXVpcmVzIEJhc2U2NC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL25vcm1hbGl6ZS1pbnB1dC5qc1wiKS5Ob3JtYWxpemVkQXR0YWNobWVudElucHV0fSBub3JtYWxpemVkSW5wdXQgLSBOb3JtYWxpemVkIGF0dGFjaG1lbnQgaW5wdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vbm9ybWFsaXplLWlucHV0LmpzXCIpLk5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXQ+fSAtIElucHV0IHVzZWQgYnkgdGhlIGRyaXZlciBhbmQgZGF0YWJhc2UuXG4gICAqL1xuICBhc3luYyBwZXJzaXN0ZW5jZUlucHV0Rm9yKG5vcm1hbGl6ZWRJbnB1dCkge1xuICAgIGlmICh0aGlzLl9jb250ZW50QmFzZTY0TnVsbGFibGUgfHwgIW5vcm1hbGl6ZWRJbnB1dC5wYXRoU291cmNlKSByZXR1cm4gbm9ybWFsaXplZElucHV0XG5cbiAgICBjb25zdCBjb250ZW50QnVmZmVyID0gYXdhaXQgbm9ybWFsaXplZElucHV0LnBhdGhTb3VyY2UucmVhZEJ1ZmZlcigpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4ubm9ybWFsaXplZElucHV0LFxuICAgICAgY29udGVudEJhc2U2NDogY29udGVudEJ1ZmZlci50b1N0cmluZyhcImJhc2U2NFwiKSxcbiAgICAgIGNvbnRlbnRCdWZmZXIsXG4gICAgICBwYXRoU291cmNlOiBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIG9uZSBub3JtYWxpemVkIGF0dGFjaG1lbnQgd2hpbGUgaXRzIHBhdGggc291cmNlIHJlbWFpbnMgb3Blbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL25vcm1hbGl6ZS1pbnB1dC5qc1wiKS5Ob3JtYWxpemVkQXR0YWNobWVudElucHV0fSBhcmdzLm5vcm1hbGl6ZWRJbnB1dCAtIE5vcm1hbGl6ZWQgYXR0YWNobWVudC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnJlcGxhY2UgLSBXaGV0aGVyIHRvIHJlcGxhY2UgZXhpc3RpbmcgYXR0YWNobWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgcGVyc2lzdE5vcm1hbGl6ZWRBdHRhY2htZW50KHttb2RlbCwgbmFtZSwgbm9ybWFsaXplZElucHV0LCByZXBsYWNlfSkge1xuICAgIGNvbnN0IGF0dGFjaG1lbnREcml2ZXIgPSBhd2FpdCB0aGlzLnJlc29sdmVBdHRhY2htZW50RHJpdmVyKHttb2RlbCwgbmFtZX0pXG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlck5hbWUgPSB0aGlzLl9hdHRhY2htZW50RHJpdmVyTmFtZUZvcih7bW9kZWwsIG5hbWV9KVxuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcbiAgICBjb25zdCByZWNvcmRUeXBlID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG4gICAgY29uc3QgcmVjb3JkSWQgPSBTdHJpbmcobW9kZWwuaWQoKSlcbiAgICBjb25zdCBhdHRhY2htZW50SWQgPSBnZW5lcmF0ZVVVSUQoKVxuICAgIC8qKlxuICAgICAqIFdyaXR0ZW4gc3RvcmFnZSBrZXkuXG4gICAgICogQHR5cGUge3N0cmluZyB8IG51bGx9ICovXG4gICAgbGV0IHN0b3JhZ2VLZXkgPSBudWxsXG4gICAgbGV0IHJvd1BlcnNpc3RlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgd3JpdGVSZXN1bHQgPSBhd2FpdCBhdHRhY2htZW50RHJpdmVyLndyaXRlKHtcbiAgICAgICAgYXR0YWNobWVudElkLFxuICAgICAgICBpbnB1dDogbm9ybWFsaXplZElucHV0LFxuICAgICAgICBtb2RlbCxcbiAgICAgICAgbmFtZVxuICAgICAgfSlcblxuICAgICAgc3RvcmFnZUtleSA9IHdyaXRlUmVzdWx0LnN0b3JhZ2VLZXlcblxuICAgICAgLy8gQ3VycmVudCBzY2hlbWFzIGtlZXAgY29udGVudF9iYXNlNjQgbnVsbGFibGUgYW5kIGF2b2lkIGR1cGxpY2F0aW5nXG4gICAgICAvLyBkcml2ZXItYmFja2VkIGNvbnRlbnQuIExlZ2FjeSBwYXRoIGlucHV0IHdhcyBtYXRlcmlhbGl6ZWQgb25jZSBiZWZvcmVcbiAgICAgIC8vIHRoZSBkcml2ZXIgd3JpdGUgc28gdGhpcyB2YWx1ZSBkZXNjcmliZXMgdGhvc2UgZXhhY3QgcGVyc2lzdGVkIGJ5dGVzLlxuICAgICAgY29uc3QgZGF0YWJhc2VDb250ZW50QmFzZTY0ID0gYXdhaXQgdGhpcy5kYXRhYmFzZUNvbnRlbnRCYXNlNjRGb3Iobm9ybWFsaXplZElucHV0KVxuXG4gICAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGlmIChyZXBsYWNlKSB7XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmdSb3dzID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgICAgICAuZnJvbShBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICAgICAgICAgIC53aGVyZSh7bmFtZSwgcmVjb3JkX2lkOiByZWNvcmRJZCwgcmVjb3JkX3R5cGU6IHJlY29yZFR5cGV9KVxuICAgICAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAgICAgZm9yIChjb25zdCBleGlzdGluZ1JvdyBvZiBleGlzdGluZ1Jvd3MpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZGVsZXRlQXR0YWNobWVudFJvd1N0b3JhZ2Uoe21vZGVsLCBuYW1lLCByb3c6IGV4aXN0aW5nUm93fSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgICAgICAgY29uZGl0aW9uczoge25hbWUsIHJlY29yZF9pZDogcmVjb3JkSWQsIHJlY29yZF90eXBlOiByZWNvcmRUeXBlfSxcbiAgICAgICAgICAgIHRhYmxlTmFtZTogQVRUQUNITUVOVFNfVEFCTEVcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcG9zaXRpb24gPSByZXBsYWNlID8gMCA6IGF3YWl0IHRoaXMuX25leHRQb3NpdGlvbih7ZGIsIG5hbWUsIHJlY29yZElkLCByZWNvcmRUeXBlfSlcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEluc2VydCBkYXRhLlxuICAgICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgICBjb25zdCBpbnNlcnREYXRhID0ge1xuICAgICAgICAgIGJ5dGVfc2l6ZTogbm9ybWFsaXplZElucHV0LmJ5dGVTaXplLFxuICAgICAgICAgIGNvbnRlbnRfYmFzZTY0OiBkYXRhYmFzZUNvbnRlbnRCYXNlNjQsXG4gICAgICAgICAgY29udGVudF90eXBlOiBub3JtYWxpemVkSW5wdXQuY29udGVudFR5cGUsXG4gICAgICAgICAgY3JlYXRlZF9hdF9tczogbm93LFxuICAgICAgICAgIGZpbGVuYW1lOiBub3JtYWxpemVkSW5wdXQuZmlsZW5hbWUsXG4gICAgICAgICAgaWQ6IGF0dGFjaG1lbnRJZCxcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIHBvc2l0aW9uLFxuICAgICAgICAgIHJlY29yZF9pZDogcmVjb3JkSWQsXG4gICAgICAgICAgcmVjb3JkX3R5cGU6IHJlY29yZFR5cGUsXG4gICAgICAgICAgdXBkYXRlZF9hdF9tczogbm93XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5fZHJpdmVyQ29sdW1uc0F2YWlsYWJsZSkge1xuICAgICAgICAgIGluc2VydERhdGEuZHJpdmVyID0gYXR0YWNobWVudERyaXZlck5hbWVcbiAgICAgICAgICBpbnNlcnREYXRhLnN0b3JhZ2Vfa2V5ID0gc3RvcmFnZUtleVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHtcbiAgICAgICAgICBkYXRhOiBpbnNlcnREYXRhLFxuICAgICAgICAgIHRhYmxlTmFtZTogQVRUQUNITUVOVFNfVEFCTEVcbiAgICAgICAgfSlcblxuICAgICAgICByb3dQZXJzaXN0ZWQgPSB0cnVlXG4gICAgICB9LCBtb2RlbClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFyb3dQZXJzaXN0ZWQgJiYgc3RvcmFnZUtleSAmJiB0eXBlb2YgYXR0YWNobWVudERyaXZlci5kZWxldGUgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGF0dGFjaG1lbnREcml2ZXIuZGVsZXRlKHtcbiAgICAgICAgICAgIG1vZGVsLFxuICAgICAgICAgICAgbmFtZSxcbiAgICAgICAgICAgIHJvdzoge2lkOiBhdHRhY2htZW50SWQsIHN0b3JhZ2Vfa2V5OiBzdG9yYWdlS2V5fSxcbiAgICAgICAgICAgIHN0b3JhZ2VLZXlcbiAgICAgICAgICB9KVxuICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbZXJyb3IsIGNsZWFudXBFcnJvcl0sXG4gICAgICAgICAgICBgQXR0YWNobWVudCB3cml0ZSBmaW5hbGl6YXRpb24gYW5kIG5ldy1zdG9yYWdlIGNsZWFudXAgYm90aCBmYWlsZWQgZm9yICR7cmVjb3JkVHlwZX0jJHtyZWNvcmRJZH0gKCR7bmFtZX0pYCxcbiAgICAgICAgICAgIHtjYXVzZTogY2xlYW51cEVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZGF0YWJhc2UgY29udGVudF9iYXNlNjQgdmFsdWUgZm9yIGN1cnJlbnQgYW5kIGxlZ2FjeSBzY2hlbWFzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbm9ybWFsaXplLWlucHV0LmpzXCIpLk5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXR9IG5vcm1hbGl6ZWRJbnB1dCAtIE5vcm1hbGl6ZWQgYXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gTnVsbGFibGUgb3IgbGVnYWN5IEJhc2U2NCBkYXRhYmFzZSB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIGRhdGFiYXNlQ29udGVudEJhc2U2NEZvcihub3JtYWxpemVkSW5wdXQpIHtcbiAgICBpZiAodGhpcy5fY29udGVudEJhc2U2NE51bGxhYmxlKSByZXR1cm4gbnVsbFxuICAgIGlmIChub3JtYWxpemVkSW5wdXQuY29udGVudEJhc2U2NCAhPT0gbnVsbCkgcmV0dXJuIG5vcm1hbGl6ZWRJbnB1dC5jb250ZW50QmFzZTY0XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJMZWdhY3kgYXR0YWNobWVudCBzY2hlbWEgcmVxdWlyZXMgbWF0ZXJpYWxpemVkIGNvbnRlbnQgYnl0ZXNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBhdHRhY2htZW50IHN0b3JlIHNjaGVtYS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gREIgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzY2hlbWEgY29sdW1ucyBhcmUgZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUF0dGFjaG1lbnRTdG9yZVNjaGVtYSh7ZGJ9KSB7XG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChBVFRBQ0hNRU5UU19UQUJMRSlcbiAgICBjb25zdCBjb2x1bW5zID0gYXdhaXQgdGFibGUuZ2V0Q29sdW1ucygpXG4gICAgY29uc3QgaGFzRHJpdmVyQ29sdW1uID0gY29sdW1ucy5zb21lKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT09IFwiZHJpdmVyXCIpXG4gICAgY29uc3QgaGFzU3RvcmFnZUtleUNvbHVtbiA9IGNvbHVtbnMuc29tZSgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09PSBcInN0b3JhZ2Vfa2V5XCIpXG4gICAgY29uc3QgY29udGVudEJhc2U2NENvbHVtbiA9IGNvbHVtbnMuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09PSBcImNvbnRlbnRfYmFzZTY0XCIpXG4gICAgY29uc3QgYWx0ZXJUYWJsZSA9IG5ldyBUYWJsZURhdGEoQVRUQUNITUVOVFNfVEFCTEUpXG4gICAgbGV0IHNob3VsZEFsdGVyID0gZmFsc2VcblxuICAgIGlmICghaGFzRHJpdmVyQ29sdW1uKSB7XG4gICAgICBhbHRlclRhYmxlLnN0cmluZyhcImRyaXZlclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICBzaG91bGRBbHRlciA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAoIWhhc1N0b3JhZ2VLZXlDb2x1bW4pIHtcbiAgICAgIGFsdGVyVGFibGUuc3RyaW5nKFwic3RvcmFnZV9rZXlcIiwge251bGw6IHRydWV9KVxuICAgICAgc2hvdWxkQWx0ZXIgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKHNob3VsZEFsdGVyKSB7XG4gICAgICBjb25zdCBhbHRlclRhYmxlU1FMcyA9IGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKGFsdGVyVGFibGUpXG5cbiAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGFsdGVyVGFibGVTUUxzKSB7XG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9kcml2ZXJDb2x1bW5zQXZhaWxhYmxlID0gdHJ1ZVxuICAgIHRoaXMuX2NvbnRlbnRCYXNlNjROdWxsYWJsZSA9IGNvbnRlbnRCYXNlNjRDb2x1bW4gPyBjb250ZW50QmFzZTY0Q29sdW1uLmdldE51bGwoKSA6IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWQgYXR0YWNobWVudCByb3cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJvdyAtIEF0dGFjaG1lbnQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxCdWZmZXI+fSAtIEF0dGFjaG1lbnQgYnl0ZXMuXG4gICAqL1xuICBhc3luYyByZWFkQXR0YWNobWVudFJvdyh7bW9kZWwsIG5hbWUsIHJvd30pIHtcbiAgICBpZiAodHlwZW9mIHJvdy5jb250ZW50X2Jhc2U2NCA9PT0gXCJzdHJpbmdcIiAmJiByb3cuY29udGVudF9iYXNlNjQubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIEJ1ZmZlci5mcm9tKHJvdy5jb250ZW50X2Jhc2U2NCwgXCJiYXNlNjRcIilcbiAgICB9XG5cbiAgICBjb25zdCBzdG9yYWdlS2V5ID0gdHlwZW9mIHJvdy5zdG9yYWdlX2tleSA9PT0gXCJzdHJpbmdcIiAmJiByb3cuc3RvcmFnZV9rZXkubGVuZ3RoID4gMCA/IHJvdy5zdG9yYWdlX2tleSA6IG51bGxcblxuICAgIGlmICghc3RvcmFnZUtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50IHJvdyAke1N0cmluZyhyb3cuaWQpfSBpcyBtaXNzaW5nIHN0b3JhZ2Uga2V5YClcbiAgICB9XG5cbiAgICBjb25zdCBhdHRhY2htZW50RHJpdmVyID0gYXdhaXQgdGhpcy5yZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWUsIHJvd30pXG5cbiAgICByZXR1cm4gYXdhaXQgYXR0YWNobWVudERyaXZlci5yZWFkKHtcbiAgICAgIG1vZGVsLFxuICAgICAgbmFtZSxcbiAgICAgIHJvdyxcbiAgICAgIHN0b3JhZ2VLZXlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCByb3cgdXJsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5yb3cgLSBBdHRhY2htZW50IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gQXR0YWNobWVudCBVUkwuXG4gICAqL1xuICBhc3luYyBhdHRhY2htZW50Um93VXJsKHttb2RlbCwgbmFtZSwgcm93fSkge1xuICAgIGNvbnN0IGF0dGFjaG1lbnREcml2ZXIgPSBhd2FpdCB0aGlzLnJlc29sdmVBdHRhY2htZW50RHJpdmVyKHttb2RlbCwgbmFtZSwgcm93fSlcblxuICAgIGlmICh0eXBlb2YgYXR0YWNobWVudERyaXZlci51cmwgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHN0b3JhZ2VLZXkgPSB0eXBlb2Ygcm93LnN0b3JhZ2Vfa2V5ID09PSBcInN0cmluZ1wiICYmIHJvdy5zdG9yYWdlX2tleS5sZW5ndGggPiAwXG4gICAgICA/IHJvdy5zdG9yYWdlX2tleVxuICAgICAgOiAodHlwZW9mIHJvdy5pZCA9PT0gXCJzdHJpbmdcIiA/IHJvdy5pZCA6IFwiXCIpXG5cbiAgICBpZiAoIXN0b3JhZ2VLZXkpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gYXdhaXQgYXR0YWNobWVudERyaXZlci51cmwoe1xuICAgICAgbW9kZWwsXG4gICAgICBuYW1lLFxuICAgICAgcm93LFxuICAgICAgc3RvcmFnZUtleVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9uZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmlkXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIEF0dGFjaG1lbnQgcm93LlxuICAgKi9cbiAgYXN5bmMgZmluZE9uZSh7aWQsIG1vZGVsLCBuYW1lfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkobW9kZWwpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkVHlwZSA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgICAgY29uc3QgcmVjb3JkSWQgPSBTdHJpbmcobW9kZWwuaWQoKSlcbiAgICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe25hbWUsIHJlY29yZF9pZDogcmVjb3JkSWQsIHJlY29yZF90eXBlOiByZWNvcmRUeXBlfSlcbiAgICAgICAgLm9yZGVyKFwicG9zaXRpb24gQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgREVTQ1wiKVxuICAgICAgICAubGltaXQoMSlcblxuICAgICAgaWYgKGlkKSB7XG4gICAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2lkfSlcbiAgICAgIH1cblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93c1swXSB8fCBudWxsXG4gICAgfSwgbW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG1hbnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSAtIEF0dGFjaG1lbnQgcm93cy5cbiAgICovXG4gIGFzeW5jIGZpbmRNYW55KHttb2RlbCwgbmFtZX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KG1vZGVsKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZFR5cGUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICAgIGNvbnN0IHJlY29yZElkID0gU3RyaW5nKG1vZGVsLmlkKCkpXG4gICAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe25hbWUsIHJlY29yZF9pZDogcmVjb3JkSWQsIHJlY29yZF90eXBlOiByZWNvcmRUeXBlfSlcbiAgICAgICAgLm9yZGVyKFwicG9zaXRpb24gQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG5cbiAgICAgIHJldHVybiBhd2FpdCBxdWVyeS5yZXN1bHRzKClcbiAgICB9LCBtb2RlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZSBhdHRhY2htZW50IHJvdyBzdG9yYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5yb3cgLSBBdHRhY2htZW50IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByb3cgc3RvcmFnZSBoYXMgYmVlbiBkZWxldGVkLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlQXR0YWNobWVudFJvd1N0b3JhZ2Uoe21vZGVsLCBuYW1lLCByb3d9KSB7XG4gICAgY29uc3Qgc3RvcmFnZUtleSA9IHR5cGVvZiByb3cuc3RvcmFnZV9rZXkgPT09IFwic3RyaW5nXCIgJiYgcm93LnN0b3JhZ2Vfa2V5Lmxlbmd0aCA+IDAgPyByb3cuc3RvcmFnZV9rZXkgOiBudWxsXG5cbiAgICBpZiAoIXN0b3JhZ2VLZXkpIHJldHVyblxuXG4gICAgY29uc3QgYXR0YWNobWVudERyaXZlciA9IGF3YWl0IHRoaXMucmVzb2x2ZUF0dGFjaG1lbnREcml2ZXIoe21vZGVsLCBuYW1lLCByb3d9KVxuXG4gICAgaWYgKHR5cGVvZiBhdHRhY2htZW50RHJpdmVyLmRlbGV0ZSAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm5cblxuICAgIGF3YWl0IGF0dGFjaG1lbnREcml2ZXIuZGVsZXRlKHtcbiAgICAgIG1vZGVsLFxuICAgICAgbmFtZSxcbiAgICAgIHJvdyxcbiAgICAgIHN0b3JhZ2VLZXlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFB1cmdlcyBldmVyeSBhdHRhY2htZW50IHN0b3JlZCB1bmRlciAobW9kZWwsIG5hbWUpOiBkZWxldGVzIGVhY2ggcm93J3NcbiAgICogYmFja2luZyBzdG9yYWdlIGFuZCB0aGVuIHJlbW92ZXMgdGhlIGF0dGFjaG1lbnQgcm93cy4gVXNlZCB0byBjbGVhbiB1cCBhblxuICAgKiBvd25lciByZWNvcmQncyBhdHRhY2htZW50cyBiZWZvcmUvd2hlbiB0aGUgb3duZXIgaXMgZGVzdHJveWVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBhdHRhY2htZW50cyBwdXJnZWQuXG4gICAqL1xuICBhc3luYyBwdXJnZUFsbCh7bW9kZWwsIG5hbWV9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeShtb2RlbClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmRUeXBlID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG4gICAgICBjb25zdCByZWNvcmRJZCA9IFN0cmluZyhtb2RlbC5pZCgpKVxuICAgICAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe25hbWUsIHJlY29yZF9pZDogcmVjb3JkSWQsIHJlY29yZF90eXBlOiByZWNvcmRUeXBlfSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAvLyBSZWZ1c2UgdG8gcHVyZ2Ugd2hlbiBhbnkgcm93J3MgZHJpdmVyIGNhbm5vdCBkZWxldGUgaXRzIGJhY2tpbmcgc3RvcmFnZTpcbiAgICAgIC8vIHJlbW92aW5nIHRoZSByb3cgd2hpbGUgdGhlIG9iamVjdCBzdGF5cyBiZWhpbmQgd291bGQgbGVhayBzdG9yYWdlIGFuZFxuICAgICAgLy8gZGlzY2FyZCB0aGUgbWV0YWRhdGEgbmVlZGVkIHRvIHJldHJ5IGNsZWFudXAuIEZhaWwgbG91ZGx5IGluc3RlYWQuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IGF0dGFjaG1lbnREcml2ZXIgPSBhd2FpdCB0aGlzLnJlc29sdmVBdHRhY2htZW50RHJpdmVyKHttb2RlbCwgbmFtZSwgcm93fSlcblxuICAgICAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnREcml2ZXIuZGVsZXRlICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBwdXJnZSBhdHRhY2htZW50ICR7cm93LmlkfSBmb3IgJHtyZWNvcmRUeXBlfSMke3JlY29yZElkfSAoJHtuYW1lfSk6IGl0cyBzdG9yYWdlIGRyaXZlciBkb2VzIG5vdCBzdXBwb3J0IGRlbGV0aW9uLmApXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZUF0dGFjaG1lbnRSb3dTdG9yYWdlKHttb2RlbCwgbmFtZSwgcm93fSlcbiAgICAgICAgLy8gRGVsZXRlIG9ubHkgdGhlIHNuYXBzaG90dGVkIHJvdyBieSBpZCwgc28gYW4gYXR0YWNobWVudCBpbnNlcnRlZCBmb3IgdGhlXG4gICAgICAgIC8vIHNhbWUgKHJlY29yZCwgbmFtZSkgYWZ0ZXIgdGhlIHNuYXBzaG90IGlzIG5vdCByZW1vdmVkIHdpdGggaXRzIHN0b3JhZ2VcbiAgICAgICAgLy8gc3RpbGwgcHJlc2VudCAod2hpY2ggd291bGQgbGVhdmUgaXQgYXMgdW5yZWFjaGFibGUgc3RvcmFnZSkuXG4gICAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7Y29uZGl0aW9uczoge2lkOiByb3cuaWR9LCB0YWJsZU5hbWU6IEFUVEFDSE1FTlRTX1RBQkxFfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJvd3MubGVuZ3RoXG4gICAgfSwgbW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRyaXZlciBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZHJpdmVyTmFtZSAtIERyaXZlciBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgaW5zdGFuY2UuXG4gICAqL1xuICBhc3luYyBhdHRhY2htZW50RHJpdmVyQnlOYW1lKGRyaXZlck5hbWUpIHtcbiAgICBpZiAodGhpcy5fYXR0YWNobWVudERyaXZlcnNCeU5hbWUuaGFzKGRyaXZlck5hbWUpKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5TmFtZS5nZXQoZHJpdmVyTmFtZSkpXG4gICAgfVxuXG4gICAgY29uc3QgYXR0YWNobWVudENvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uPy4oKSB8fCB7fVxuICAgIGNvbnN0IGNvbmZpZ3VyZWREcml2ZXIgPSBhdHRhY2htZW50Q29uZmlndXJhdGlvbi5kcml2ZXJzPy5bZHJpdmVyTmFtZV1cbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGF0dGFjaG1lbnREcml2ZXIuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBsZXQgYXR0YWNobWVudERyaXZlclxuXG4gICAgaWYgKCFjb25maWd1cmVkRHJpdmVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbmZpZ3VyZWQgYXR0YWNobWVudCBzdG9yYWdlIGRyaXZlciBuYW1lZCBcIiR7ZHJpdmVyTmFtZX1cImApXG4gICAgfSBlbHNlIGlmIChjb25maWd1cmVkRHJpdmVyLmluc3RhbmNlICYmIHR5cGVvZiBjb25maWd1cmVkRHJpdmVyLmluc3RhbmNlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBhdHRhY2htZW50RHJpdmVyID0gY29uZmlndXJlZERyaXZlci5pbnN0YW5jZVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIuZHJpdmVyQ2xhc3MgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXR0YWNobWVudERyaXZlciA9IG5ldyBjb25maWd1cmVkRHJpdmVyLmRyaXZlckNsYXNzKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBuYW1lOiBkcml2ZXJOYW1lLFxuICAgICAgICBvcHRpb25zOiBjb25maWd1cmVkRHJpdmVyXG4gICAgICB9KVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIuY3JlYXRlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBjb25maWd1cmVkRHJpdmVyLmNyZWF0ZSh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgbmFtZTogZHJpdmVyTmFtZSxcbiAgICAgICAgb3B0aW9uczogY29uZmlndXJlZERyaXZlclxuICAgICAgfSlcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50IHN0b3JhZ2UgZHJpdmVyIFwiJHtkcml2ZXJOYW1lfVwiIG11c3QgZGVmaW5lIGluc3RhbmNlLCBkcml2ZXJDbGFzcywgb3IgY3JlYXRlYClcbiAgICB9XG5cbiAgICBpZiAoIWF0dGFjaG1lbnREcml2ZXIgfHwgdHlwZW9mIGF0dGFjaG1lbnREcml2ZXIud3JpdGUgIT09IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgYXR0YWNobWVudERyaXZlci5yZWFkICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCBzdG9yYWdlIGRyaXZlciBcIiR7ZHJpdmVyTmFtZX1cIiBtdXN0IGltcGxlbWVudCB3cml0ZS9yZWFkYClcbiAgICB9XG5cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5TmFtZS5zZXQoZHJpdmVyTmFtZSwgYXR0YWNobWVudERyaXZlcilcblxuICAgIHJldHVybiBhdHRhY2htZW50RHJpdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRyaXZlciBieSByZWZlcmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuZHJpdmVyUmVmZXJlbmNlIC0gRHJpdmVyIGNsYXNzIG9yIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQXR0YWNobWVudCBkcml2ZXIgaW5zdGFuY2UuXG4gICAqL1xuICBhdHRhY2htZW50RHJpdmVyQnlSZWZlcmVuY2Uoe2F0dGFjaG1lbnROYW1lLCBkcml2ZXJSZWZlcmVuY2UsIG1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlSZWZlcmVuY2UuaGFzKGRyaXZlclJlZmVyZW5jZSkpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHRoaXMuX2F0dGFjaG1lbnREcml2ZXJzQnlSZWZlcmVuY2UuZ2V0KGRyaXZlclJlZmVyZW5jZSkpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBhdHRhY2htZW50RHJpdmVyLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgbGV0IGF0dGFjaG1lbnREcml2ZXJcblxuICAgIGlmICh0eXBlb2YgZHJpdmVyUmVmZXJlbmNlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGNvbnN0IERyaXZlckNsYXNzID0gLyoqIEB0eXBlIHtBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3J9ICovIChkcml2ZXJSZWZlcmVuY2UpXG5cbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBuZXcgRHJpdmVyQ2xhc3Moe1xuICAgICAgICBhdHRhY2htZW50TmFtZSxcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBtb2RlbENsYXNzXG4gICAgICB9KVxuICAgIH0gZWxzZSBpZiAoZHJpdmVyUmVmZXJlbmNlICYmIHR5cGVvZiBkcml2ZXJSZWZlcmVuY2UgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGF0dGFjaG1lbnREcml2ZXIgPSBkcml2ZXJSZWZlcmVuY2VcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGF0dGFjaG1lbnQgZHJpdmVyIHJlZmVyZW5jZSBmb3IgJHttb2RlbENsYXNzLm5hbWV9IyR7YXR0YWNobWVudE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnREcml2ZXIud3JpdGUgIT09IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgYXR0YWNobWVudERyaXZlci5yZWFkICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCBkcml2ZXIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfSMke2F0dGFjaG1lbnROYW1lfSBtdXN0IGltcGxlbWVudCB3cml0ZS9yZWFkYClcbiAgICB9XG5cbiAgICB0aGlzLl9hdHRhY2htZW50RHJpdmVyc0J5UmVmZXJlbmNlLnNldChkcml2ZXJSZWZlcmVuY2UsIGF0dGFjaG1lbnREcml2ZXIpXG5cbiAgICByZXR1cm4gYXR0YWNobWVudERyaXZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkcml2ZXIgbmFtZSBmb3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBkcml2ZXIgbmFtZS5cbiAgICovXG4gIF9hdHRhY2htZW50RHJpdmVyTmFtZUZvcih7bW9kZWwsIG5hbWV9KSB7XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0YWNobWVudEJ5TmFtZShuYW1lKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWREcml2ZXIgPSBhdHRhY2htZW50RGVmaW5pdGlvbi5kcml2ZXJcbiAgICBjb25zdCBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uPy4oKSB8fCB7fVxuICAgIGNvbnN0IGRlZmF1bHREcml2ZXIgPSBhdHRhY2htZW50c0NvbmZpZ3VyYXRpb24uZGVmYXVsdERyaXZlclxuXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkRHJpdmVyID09PSBcInN0cmluZ1wiICYmIGNvbmZpZ3VyZWREcml2ZXIubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGNvbmZpZ3VyZWREcml2ZXJcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIGNvbmZpZ3VyZWREcml2ZXIubmFtZSB8fCBcImN1c3RvbVwiXG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZ3VyZWREcml2ZXIgJiYgdHlwZW9mIGNvbmZpZ3VyZWREcml2ZXIgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGNvbnN0IGNvbnN0cnVjdG9yTmFtZSA9IGNvbmZpZ3VyZWREcml2ZXIuY29uc3RydWN0b3I/Lm5hbWVcblxuICAgICAgaWYgKHR5cGVvZiBjb25zdHJ1Y3Rvck5hbWUgPT09IFwic3RyaW5nXCIgJiYgY29uc3RydWN0b3JOYW1lLmxlbmd0aCA+IDAgJiYgY29uc3RydWN0b3JOYW1lICE9PSBcIk9iamVjdFwiKSB7XG4gICAgICAgIHJldHVybiBjb25zdHJ1Y3Rvck5hbWVcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIFwiY3VzdG9tXCJcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRlZmF1bHREcml2ZXIgPT09IFwic3RyaW5nXCIgJiYgZGVmYXVsdERyaXZlci5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gZGVmYXVsdERyaXZlclxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgTm8gYXR0YWNobWVudCBkcml2ZXIgY29uZmlndXJlZCBmb3IgJHttb2RlbC5nZXRNb2RlbENsYXNzKCkubmFtZX0jJHtuYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGF0dGFjaG1lbnQgZHJpdmVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3Mucm93XSAtIEF0dGFjaG1lbnQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgaW5zdGFuY2UuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQXR0YWNobWVudERyaXZlcih7bW9kZWwsIG5hbWUsIHJvd30pIHtcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRhY2htZW50QnlOYW1lKG5hbWUpXG4gICAgY29uc3QgY29uZmlndXJlZERyaXZlciA9IGF0dGFjaG1lbnREZWZpbml0aW9uLmRyaXZlclxuICAgIGlmICh0eXBlb2YgY29uZmlndXJlZERyaXZlciA9PT0gXCJmdW5jdGlvblwiIHx8IChjb25maWd1cmVkRHJpdmVyICYmIHR5cGVvZiBjb25maWd1cmVkRHJpdmVyID09PSBcIm9iamVjdFwiKSkge1xuICAgICAgcmV0dXJuIHRoaXMuYXR0YWNobWVudERyaXZlckJ5UmVmZXJlbmNlKHtcbiAgICAgICAgYXR0YWNobWVudE5hbWU6IG5hbWUsXG4gICAgICAgIGRyaXZlclJlZmVyZW5jZTogY29uZmlndXJlZERyaXZlcixcbiAgICAgICAgbW9kZWxDbGFzczogbW9kZWwuZ2V0TW9kZWxDbGFzcygpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IGZhbGxiYWNrRHJpdmVyTmFtZSA9IHR5cGVvZiByb3c/LmRyaXZlciA9PT0gXCJzdHJpbmdcIiAmJiByb3cuZHJpdmVyLmxlbmd0aCA+IDBcbiAgICAgID8gcm93LmRyaXZlclxuICAgICAgOiB0aGlzLl9hdHRhY2htZW50RHJpdmVyTmFtZUZvcih7bW9kZWwsIG5hbWV9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuYXR0YWNobWVudERyaXZlckJ5TmFtZShmYWxsYmFja0RyaXZlck5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IHBvc2l0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEQiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWNvcmRJZCAtIFJlY29yZCBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVjb3JkVHlwZSAtIFJlY29yZCB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE5leHQgcG9zaXRpb24uXG4gICAqL1xuICBhc3luYyBfbmV4dFBvc2l0aW9uKHtkYiwgbmFtZSwgcmVjb3JkSWQsIHJlY29yZFR5cGV9KSB7XG4gICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEFUVEFDSE1FTlRTX1RBQkxFKVxuICAgICAgLndoZXJlKHtuYW1lLCByZWNvcmRfaWQ6IHJlY29yZElkLCByZWNvcmRfdHlwZTogcmVjb3JkVHlwZX0pXG4gICAgICAub3JkZXIoXCJwb3NpdGlvbiBERVNDXCIpXG4gICAgICAubGltaXQoMSlcbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgY29uc3QgY3VycmVudFJvdyA9IC8qKiBAdHlwZSB7e3Bvc2l0aW9uPzogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gfCB1bmRlZmluZWR9ICovIChyb3dzWzBdKVxuICAgIGNvbnN0IGN1cnJlbnQgPSBOdW1iZXIoY3VycmVudFJvdz8ucG9zaXRpb24pXG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShjdXJyZW50KSkgcmV0dXJuIDBcblxuICAgIHJldHVybiBjdXJyZW50ICsgMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkYi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IFttb2RlbF0gLSBPcGVyYXRpb24tb3duaW5nIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aERiKGNhbGxiYWNrLCBtb2RlbCkge1xuICAgIGlmIChtb2RlbCAmJiBtb2RlbC5kYXRhYmFzZU9wZXJhdGlvbigpKSByZXR1cm4gYXdhaXQgY2FsbGJhY2sobW9kZWwuY29ubmVjdGlvbigpKVxuXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2wodGhpcy5kYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyByZXN1bHQuXG4gICAgICogQHR5cGUge1QgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHJlc3VsdFxuXG4gICAgYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJSZWNvcmQgYXR0YWNobWVudCBzdG9yZVwifSwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXN1bHQgPSBhd2FpdCBjYWxsYmFjayhkYilcbiAgICB9KVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHJlc3VsdClcbiAgfVxufVxuIl19