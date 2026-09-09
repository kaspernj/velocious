// @ts-check
import BetterLocalStorage from "better-localstorage";
/**
 * SQLite web persistence adapter.
 * @typedef {object} SqliteWebPersistence
 * @property {"indexeddb" | "localstorage" | "opfs"} name - Persistence backend name.
 * @property {() => Promise<void>} delete - Deletes the persisted database.
 * @property {() => Promise<Uint8Array | undefined>} load - Loads persisted database bytes.
 * @property {(content: Uint8Array) => Promise<void>} save - Saves persisted database bytes.
 */
/**
 * Browser-like environment used for web persistence detection.
 * @typedef {object} SqliteWebPersistenceEnvironment
 * @property {unknown} [indexedDB] - IndexedDB global.
 * @property {unknown} [navigator] - Navigator global.
 */
const SUPPORT_CHECK_FILE = ".velocious-opfs-support-check";
const SUPPORT_CHECK_BYTES = new Uint8Array([118, 101, 108, 111, 99, 105, 111, 117, 115]);
/**
 * Creates the best SQLite web persistence adapter supported by the current browser.
 * @param {object} args - Arguments.
 * @param {string} args.databaseName - Database name.
 * @param {SqliteWebPersistenceEnvironment} [args.environment] - Browser-like environment.
 * @returns {Promise<SqliteWebPersistence>} - Selected persistence adapter.
 */
export async function createSqliteWebPersistence({ databaseName, environment = globalThis }) {
    const localStoragePersistence = new LocalStoragePersistence({ databaseName });
    const opfsPersistence = new OpfsPersistence({ databaseName, environment });
    const indexedDbPersistence = new IndexedDbPersistence({ databaseName, environment });
    const selectedPersistence = await selectSupportedPersistence({ environment, indexedDbPersistence, localStoragePersistence, opfsPersistence });
    await migratePersistedDatabase({
        databaseName,
        destinationPersistence: selectedPersistence,
        environment,
        sourcePersistences: [localStoragePersistence, indexedDbPersistence, opfsPersistence]
    });
    return selectedPersistence;
}
/**
 * Deletes SQLite web database bytes from every available persistence backend.
 * @param {object} args - Arguments.
 * @param {string} args.databaseName - Database name.
 * @param {SqliteWebPersistenceEnvironment} [args.environment] - Browser-like environment.
 * @returns {Promise<void>} - Resolves when all available backends were cleared.
 */
export async function deleteSqliteWebPersistences({ databaseName, environment = globalThis }) {
    const persistences = [
        new LocalStoragePersistence({ databaseName }),
        new OpfsPersistence({ databaseName, environment }),
        new IndexedDbPersistence({ databaseName, environment })
    ];
    for (const persistence of persistences)
        await deletePersistenceIfAvailable(persistence);
}
/**
 * Returns the legacy SQLite web storage key for a database name.
 * @param {string} databaseName - Database name.
 * @returns {string} - Persistence key.
 */
export function sqliteWebPersistenceKey(databaseName) {
    if (!databaseName)
        throw new Error("No name given in arguments for SQLite Web database");
    return `VelociousDatabaseDriversSqliteWeb---${databaseName}`;
}
/** OPFS-backed SQL.js database file persistence. */
class OpfsPersistence {
    /** @type {"opfs"} */
    name = "opfs";
    /**
     * Creates OPFS persistence.
     * @param {object} args - Arguments.
     * @param {string} args.databaseName - Database name.
     * @param {SqliteWebPersistenceEnvironment} args.environment - Browser-like environment.
     */
    constructor({ databaseName, environment }) {
        this.databaseName = databaseName;
        this.environment = environment;
    }
    /**
     * Deletes the OPFS database file.
     * @returns {Promise<void>} - Resolves when deleted.
     */
    async delete() {
        const directory = await opfsDirectory(this.environment);
        try {
            await directory.removeEntry(sqliteWebPersistenceKey(this.databaseName));
        }
        catch (error) {
            if (!isNotFoundError(error))
                throw error;
        }
    }
    /**
     * Loads the OPFS database file.
     * @returns {Promise<Uint8Array | undefined>} - Persisted bytes.
     */
    async load() {
        const directory = await opfsDirectory(this.environment);
        try {
            const fileHandle = await directory.getFileHandle(sqliteWebPersistenceKey(this.databaseName));
            const file = await fileHandle.getFile();
            const arrayBuffer = await file.arrayBuffer();
            return new Uint8Array(arrayBuffer);
        }
        catch (error) {
            if (isNotFoundError(error))
                return undefined;
            throw error;
        }
    }
    /**
     * Checks whether the OPFS database file exists.
     * @returns {Promise<boolean>} - Whether content exists.
     */
    async exists() {
        try {
            return (await this.load()) !== undefined;
        }
        catch {
            return false;
        }
    }
    /**
     * Saves database bytes.
     * @param {Uint8Array} content - Database bytes.
     * @returns {Promise<void>} - Resolves when saved.
     */
    async save(content) {
        const directory = await opfsDirectory(this.environment);
        const fileHandle = await directory.getFileHandle(sqliteWebPersistenceKey(this.databaseName), { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(arrayBufferFromBytes(content));
        await writable.close();
    }
}
/** IndexedDB-backed SQL.js database blob persistence. */
class IndexedDbPersistence {
    /** @type {"indexeddb"} */
    name = "indexeddb";
    /**
     * Creates IndexedDB persistence.
     * @param {object} args - Arguments.
     * @param {string} args.databaseName - Database name.
     * @param {SqliteWebPersistenceEnvironment} args.environment - Browser-like environment.
     */
    constructor({ databaseName, environment }) {
        this.databaseName = databaseName;
        this.environment = environment;
    }
    /**
     * Deletes the IndexedDB database entry.
     * @returns {Promise<void>} - Resolves when deleted.
     */
    async delete() {
        const database = await openIndexedDb(this.environment);
        await indexedDbRequest(database.transaction("databases", "readwrite").objectStore("databases").delete(sqliteWebPersistenceKey(this.databaseName)));
        database.close();
    }
    /**
     * Loads the IndexedDB database entry.
     * @returns {Promise<Uint8Array | undefined>} - Persisted bytes.
     */
    async load() {
        const database = await openIndexedDb(this.environment);
        const result = await indexedDbRequest(database.transaction("databases", "readonly").objectStore("databases").get(sqliteWebPersistenceKey(this.databaseName)));
        database.close();
        if (result === undefined)
            return undefined;
        if (result instanceof Uint8Array)
            return result;
        if (result instanceof ArrayBuffer)
            return new Uint8Array(result);
        throw new Error("SQLite web IndexedDB persistence returned unsupported content");
    }
    /**
     * Checks whether the IndexedDB database entry exists.
     * @returns {Promise<boolean>} - Whether content exists.
     */
    async exists() {
        try {
            const database = await openIndexedDb(this.environment);
            const result = await indexedDbRequest(database.transaction("databases", "readonly").objectStore("databases").get(sqliteWebPersistenceKey(this.databaseName)));
            database.close();
            return result !== undefined && result !== null;
        }
        catch {
            return false;
        }
    }
    /**
     * Saves database bytes.
     * @param {Uint8Array} content - Database bytes.
     * @returns {Promise<void>} - Resolves when saved.
     */
    async save(content) {
        const database = await openIndexedDb(this.environment);
        await indexedDbRequest(database.transaction("databases", "readwrite").objectStore("databases").put(content, sqliteWebPersistenceKey(this.databaseName)));
        database.close();
    }
}
/** LocalStorage-backed SQL.js database blob persistence for legacy migrations. */
class LocalStoragePersistence {
    /** @type {"localstorage"} */
    name = "localstorage";
    /**
     * Creates localStorage persistence.
     * @param {object} args - Arguments.
     * @param {string} args.databaseName - Database name.
     */
    constructor({ databaseName }) {
        this.databaseName = databaseName;
        /** @type {BetterLocalStorage | undefined} */
        this.storage = undefined;
    }
    /**
     * Deletes the localStorage database entry.
     * @returns {Promise<void>} - Resolves when deleted.
     */
    async delete() {
        await this.localStorage().delete(sqliteWebPersistenceKey(this.databaseName));
    }
    /**
     * Loads the localStorage database entry.
     * @returns {Promise<Uint8Array | undefined>} - Persisted bytes.
     */
    async load() {
        const content = await this.localStorage().get(sqliteWebPersistenceKey(this.databaseName));
        if (content === null || content === undefined)
            return undefined;
        if (content instanceof Uint8Array)
            return content;
        if (content instanceof ArrayBuffer)
            return new Uint8Array(content);
        return /** @type {Uint8Array} */ (content);
    }
    /**
     * Saves database bytes.
     * @param {Uint8Array} content - Database bytes.
     * @returns {Promise<void>} - Resolves when saved.
     */
    async save(content) {
        await this.localStorage().set(sqliteWebPersistenceKey(this.databaseName), content);
    }
    /**
     * Checks whether the legacy localStorage database exists.
     * @returns {Promise<boolean>} - Whether content exists.
     */
    async exists() {
        try {
            const content = await this.localStorage().get(sqliteWebPersistenceKey(this.databaseName));
            return content !== undefined && content !== null;
        }
        catch {
            return false;
        }
    }
    /**
     * Returns the localStorage wrapper.
     * @returns {BetterLocalStorage} - Storage wrapper.
     */
    localStorage() {
        this.storage ||= new BetterLocalStorage();
        return this.storage;
    }
}
/**
 * Selects the preferred available SQLite web persistence backend.
 * @param {object} args - Arguments.
 * @param {SqliteWebPersistenceEnvironment} args.environment - Browser-like environment.
 * @param {IndexedDbPersistence} args.indexedDbPersistence - IndexedDB persistence adapter.
 * @param {LocalStoragePersistence} args.localStoragePersistence - Legacy localStorage persistence adapter.
 * @param {OpfsPersistence} args.opfsPersistence - OPFS persistence adapter.
 * @returns {Promise<SqliteWebPersistence>} - Selected persistence adapter.
 */
async function selectSupportedPersistence({ environment, indexedDbPersistence, localStoragePersistence, opfsPersistence }) {
    if (await supportsOpfsPersistence(environment))
        return opfsPersistence;
    if (await supportsIndexedDbPersistence(environment))
        return indexedDbPersistence;
    return localStoragePersistence;
}
/**
 * Migrates any existing database bytes into the selected persistence backend.
 * @param {object} args - Arguments.
 * @param {string} args.databaseName - Database name.
 * @param {SqliteWebPersistence} args.destinationPersistence - Selected persistence adapter.
 * @param {SqliteWebPersistenceEnvironment} args.environment - Browser-like environment.
 * @param {{delete: () => Promise<void>, load: () => Promise<Uint8Array | undefined>}[]} args.sourcePersistences - Persistence adapters to scan for existing bytes.
 * @returns {Promise<void>} - Resolves when migration is complete.
 */
async function migratePersistedDatabase({ databaseName, destinationPersistence, environment, sourcePersistences }) {
    if (await destinationPersistence.load() !== undefined)
        return;
    for (const sourcePersistence of sourcePersistences) {
        if (sourcePersistence === destinationPersistence)
            continue;
        const databaseBytes = await loadPersistenceIfAvailable(sourcePersistence);
        if (databaseBytes === undefined)
            continue;
        await destinationPersistence.save(databaseBytes);
        await deleteSqliteWebPersistences({ databaseName, environment });
        await destinationPersistence.save(databaseBytes);
        return;
    }
}
/**
 * Loads a persistence backend, ignoring unavailable backend errors.
 * @param {{load: () => Promise<Uint8Array | undefined>}} persistence - Persistence adapter.
 * @returns {Promise<Uint8Array | undefined>} - Persisted bytes, if available.
 */
async function loadPersistenceIfAvailable(persistence) {
    try {
        return await persistence.load();
    }
    catch {
        return undefined;
    }
}
/**
 * Tests whether OPFS persistence is usable.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {Promise<boolean>} - Whether OPFS can be used.
 */
async function supportsOpfsPersistence(environment) {
    try {
        const directory = await opfsDirectory(environment);
        const fileHandle = await directory.getFileHandle(SUPPORT_CHECK_FILE, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(arrayBufferFromBytes(SUPPORT_CHECK_BYTES));
        await writable.close();
        const file = await fileHandle.getFile();
        const readBack = new Uint8Array(await file.arrayBuffer());
        await directory.removeEntry(SUPPORT_CHECK_FILE);
        return sameBytes(readBack, SUPPORT_CHECK_BYTES);
    }
    catch {
        return false;
    }
}
/**
 * Tests whether IndexedDB persistence is usable.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {Promise<boolean>} - Whether IndexedDB can be used.
 */
async function supportsIndexedDbPersistence(environment) {
    try {
        const database = await openIndexedDb(environment);
        const store = database.transaction("databases", "readwrite").objectStore("databases");
        await indexedDbRequest(store.put(SUPPORT_CHECK_BYTES, SUPPORT_CHECK_FILE));
        const readBack = await indexedDbRequest(store.get(SUPPORT_CHECK_FILE));
        await indexedDbRequest(store.delete(SUPPORT_CHECK_FILE));
        database.close();
        return readBack instanceof Uint8Array && sameBytes(readBack, SUPPORT_CHECK_BYTES);
    }
    catch {
        return false;
    }
}
/**
 * Opens the SQLite web IndexedDB database.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {Promise<IDBDatabase>} - Open database.
 */
async function openIndexedDb(environment) {
    const indexedDb = indexedDbFromEnvironment(environment);
    if (!indexedDb || typeof indexedDb.open !== "function")
        throw new Error("IndexedDB is not available");
    const request = indexedDb.open("VelociousDatabaseDriversSqliteWeb", 1);
    request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("databases"))
            database.createObjectStore("databases");
    };
    return await indexedDbRequest(request);
}
/**
 * Resolves an IndexedDB request.
 * @template T
 * @param {IDBRequest<T>} request - IndexedDB request.
 * @returns {Promise<T>} - Request result.
 */
function indexedDbRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
}
/**
 * Deletes a persistence backend, ignoring unavailable backend errors.
 * @param {{delete: () => Promise<void>}} persistence - Persistence adapter.
 * @returns {Promise<void>} - Resolves when deletion was attempted.
 */
async function deletePersistenceIfAvailable(persistence) {
    try {
        await persistence.delete();
    }
    catch {
        // Ignore unavailable backends so reset clears every backend the browser can access.
    }
}
/**
 * Gets OPFS root directory.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {Promise<FileSystemDirectoryHandle>} - OPFS root directory.
 */
async function opfsDirectory(environment) {
    const navigatorObject = navigatorFromEnvironment(environment);
    const storage = navigatorObject.storage;
    if (!storage || typeof storage.getDirectory !== "function")
        throw new Error("OPFS is not available");
    return await storage.getDirectory();
}
/**
 * Gets navigator from environment.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {{storage?: {getDirectory?: () => Promise<FileSystemDirectoryHandle>}}} - Navigator-like object.
 */
function navigatorFromEnvironment(environment) {
    const candidate = environment.navigator;
    if (!candidate || typeof candidate !== "object")
        return {};
    return /** @type {{storage?: {getDirectory?: () => Promise<FileSystemDirectoryHandle>}}} */ (candidate);
}
/**
 * Gets IndexedDB from environment.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {{open?: (name: string, version?: number) => IDBOpenDBRequest} | undefined} - IndexedDB-like object.
 */
function indexedDbFromEnvironment(environment) {
    const candidate = environment.indexedDB;
    if (!candidate || typeof candidate !== "object")
        return undefined;
    return /** @type {{open?: (name: string, version?: number) => IDBOpenDBRequest}} */ (candidate);
}
/**
 * Converts bytes to a standalone ArrayBuffer for browser file writes.
 * @param {Uint8Array} bytes - Bytes to convert.
 * @returns {ArrayBuffer} - Standalone ArrayBuffer.
 */
function arrayBufferFromBytes(bytes) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}
/**
 * Checks whether an error is a file-not-found error.
 * @param {unknown} error - Error candidate.
 * @returns {boolean} - Whether the error is not found.
 */
function isNotFoundError(error) {
    return error instanceof Error && error.name === "NotFoundError";
}
/**
 * Compares two byte arrays.
 * @param {Uint8Array} left - Left bytes.
 * @param {Uint8Array} right - Right bytes.
 * @returns {boolean} - Whether bytes match.
 */
function sameBytes(left, right) {
    if (left.length !== right.length)
        return false;
    return left.every((value, index) => value === right[index]);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViLXBlcnNpc3RlbmNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvc3FsaXRlL3dlYi1wZXJzaXN0ZW5jZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxrQkFBa0IsTUFBTSxxQkFBcUIsQ0FBQTtBQUVwRDs7Ozs7OztHQU9HO0FBQ0g7Ozs7O0dBS0c7QUFDSCxNQUFNLGtCQUFrQixHQUFHLCtCQUErQixDQUFBO0FBQzFELE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxVQUFVLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUE7QUFFeEY7Ozs7OztHQU1HO0FBQ0gsTUFBTSxDQUFDLEtBQUssVUFBVSwwQkFBMEIsQ0FBQyxFQUFDLFlBQVksRUFBRSxXQUFXLEdBQUcsVUFBVSxFQUFDO0lBQ3ZGLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSx1QkFBdUIsQ0FBQyxFQUFDLFlBQVksRUFBQyxDQUFDLENBQUE7SUFDM0UsTUFBTSxlQUFlLEdBQUcsSUFBSSxlQUFlLENBQUMsRUFBQyxZQUFZLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtJQUN4RSxNQUFNLG9CQUFvQixHQUFHLElBQUksb0JBQW9CLENBQUMsRUFBQyxZQUFZLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtJQUVsRixNQUFNLG1CQUFtQixHQUFHLE1BQU0sMEJBQTBCLENBQUMsRUFBQyxXQUFXLEVBQUUsb0JBQW9CLEVBQUUsdUJBQXVCLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQTtJQUUzSSxNQUFNLHdCQUF3QixDQUFDO1FBQzdCLFlBQVk7UUFDWixzQkFBc0IsRUFBRSxtQkFBbUI7UUFDM0MsV0FBVztRQUNYLGtCQUFrQixFQUFFLENBQUMsdUJB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LE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQTtBQUNwQixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZUFBZSxDQUFDLEtBQUs7SUFDNUIsT0FBTyxLQUFLLFlBQVksS0FBSyxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssZUFBZSxDQUFBO0FBQ2pFLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsU0FBUyxDQUFDLElBQUksRUFBRSxLQUFLO0lBQzVCLElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxLQUFLLENBQUMsTUFBTTtRQUFFLE9BQU8sS0FBSyxDQUFBO0lBRTlDLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssS0FBSyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtBQUM3RCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCZXR0ZXJMb2NhbFN0b3JhZ2UgZnJvbSBcImJldHRlci1sb2NhbHN0b3JhZ2VcIlxuXG4vKipcbiAqIFNRTGl0ZSB3ZWIgcGVyc2lzdGVuY2UgYWRhcHRlci5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNxbGl0ZVdlYlBlcnNpc3RlbmNlXG4gKiBAcHJvcGVydHkge1wiaW5kZXhlZGRiXCIgfCBcImxvY2Fsc3RvcmFnZVwiIHwgXCJvcGZzXCJ9IG5hbWUgLSBQZXJzaXN0ZW5jZSBiYWNrZW5kIG5hbWUuXG4gKiBAcHJvcGVydHkgeygpID0+IFByb21pc2U8dm9pZD59IGRlbGV0ZSAtIERlbGV0ZXMgdGhlIHBlcnNpc3RlZCBkYXRhYmFzZS5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gUHJvbWlzZTxVaW50OEFycmF5IHwgdW5kZWZpbmVkPn0gbG9hZCAtIExvYWRzIHBlcnNpc3RlZCBkYXRhYmFzZSBieXRlcy5cbiAqIEBwcm9wZXJ0eSB7KGNvbnRlbnQ6IFVpbnQ4QXJyYXkpID0+IFByb21pc2U8dm9pZD59IHNhdmUgLSBTYXZlcyBwZXJzaXN0ZWQgZGF0YWJhc2UgYnl0ZXMuXG4gKi9cbi8qKlxuICogQnJvd3Nlci1saWtlIGVudmlyb25tZW50IHVzZWQgZm9yIHdlYiBwZXJzaXN0ZW5jZSBkZXRlY3Rpb24uXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTcWxpdGVXZWJQZXJzaXN0ZW5jZUVudmlyb25tZW50XG4gKiBAcHJvcGVydHkge3Vua25vd259IFtpbmRleGVkREJdIC0gSW5kZXhlZERCIGdsb2JhbC5cbiAqIEBwcm9wZXJ0eSB7dW5rbm93bn0gW25hdmlnYXRvcl0gLSBOYXZpZ2F0b3IgZ2xvYmFsLlxuICovXG5jb25zdCBTVVBQT1JUX0NIRUNLX0ZJTEUgPSBcIi52ZWxvY2lvdXMtb3Bmcy1zdXBwb3J0LWNoZWNrXCJcbmNvbnN0IFNVUFBPUlRfQ0hFQ0tfQllURVMgPSBuZXcgVWludDhBcnJheShbMTE4LCAxMDEsIDEwOCwgMTExLCA5OSwgMTA1LCAxMTEsIDExNywgMTE1XSlcblxuLyoqXG4gKiBDcmVhdGVzIHRoZSBiZXN0IFNRTGl0ZSB3ZWIgcGVyc2lzdGVuY2UgYWRhcHRlciBzdXBwb3J0ZWQgYnkgdGhlIGN1cnJlbnQgYnJvd3Nlci5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAqIEBwYXJhbSB7U3FsaXRlV2ViUGVyc2lzdGVuY2VFbnZpcm9ubWVudH0gW2FyZ3MuZW52aXJvbm1lbnRdIC0gQnJvd3Nlci1saWtlIGVudmlyb25tZW50LlxuICogQHJldHVybnMge1Byb21pc2U8U3FsaXRlV2ViUGVyc2lzdGVuY2U+fSAtIFNlbGVjdGVkIHBlcnNpc3RlbmNlIGFkYXB0ZXIuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVTcWxpdGVXZWJQZXJzaXN0ZW5jZSh7ZGF0YWJhc2VOYW1lLCBlbnZpcm9ubWVudCA9IGdsb2JhbFRoaXN9KSB7XG4gIGNvbnN0IGxvY2FsU3RvcmFnZVBlcnNpc3RlbmNlID0gbmV3IExvY2FsU3RvcmFnZVBlcnNpc3RlbmNlKHtkYXRhYmFzZU5hbWV9KVxuICBjb25zdCBvcGZzUGVyc2lzdGVuY2UgPSBuZXcgT3Bmc1BlcnNpc3RlbmNlKHtkYXRhYmFzZU5hbWUsIGVudmlyb25tZW50fSlcbiAgY29uc3QgaW5kZXhlZERiUGVyc2lzdGVuY2UgPSBuZXcgSW5kZXhlZERiUGVyc2lzdGVuY2Uoe2RhdGFiYXNlTmFtZSwgZW52aXJvbm1lbnR9KVxuXG4gIGNvbnN0IHNlbGVjdGVkUGVyc2lzdGVuY2UgPSBhd2FpdCBzZWxlY3RTdXBwb3J0ZWRQZXJzaXN0ZW5jZSh7ZW52aXJvbm1lbnQsIGluZGV4ZWREYlBlcnNpc3RlbmNlLCBsb2NhbFN0b3JhZ2VQZXJzaXN0ZW5jZSwgb3Bmc1BlcnNpc3RlbmNlfSlcblxuICBhd2FpdCBtaWdyYXRlUGVyc2lzdGVkRGF0YWJhc2Uoe1xuICAgIGRhdGFiYXNlTmFtZSxcbiAgICBkZXN0aW5hdGlvblBlcnNpc3RlbmNlOiBzZWxlY3RlZFBlcnNpc3RlbmNlLFxuICAgIGVudmlyb25tZW50LFxuICAgIHNvdXJjZVBlcnNpc3RlbmNlczogW2xvY2FsU3RvcmFnZVBlcnNpc3RlbmNlLCBpbmRleGVkRGJQZXJzaXN0ZW5jZSwgb3Bmc1BlcnNpc3RlbmNlXVxuICB9KVxuXG4gIHJldHVybiBzZWxlY3RlZFBlcnNpc3RlbmNlXG59XG5cbi8qKlxuICogRGVsZXRlcyBTUUxpdGUgd2ViIGRhdGFiYXNlIGJ5dGVzIGZyb20gZXZlcnkgYXZhaWxhYmxlIHBlcnNpc3RlbmNlIGJhY2tlbmQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gKiBAcGFyYW0ge1NxbGl0ZVdlYlBlcnNpc3RlbmNlRW52aXJvbm1lbnR9IFthcmdzLmVudmlyb25tZW50XSAtIEJyb3dzZXItbGlrZSBlbnZpcm9ubWVudC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWxsIGF2YWlsYWJsZSBiYWNrZW5kcyB3ZXJlIGNsZWFyZWQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVTcWxpdGVXZWJQZXJzaXN0ZW5jZXMoe2RhdGFiYXNlTmFtZSwgZW52aXJvbm1lbnQgPSBnbG9iYWxUaGlzfSkge1xuICBjb25zdCBwZXJzaXN0ZW5jZXMgPSBbXG4gICAgbmV3IExvY2FsU3RvcmFnZVBlcnNpc3RlbmNlKHtkYXRhYmFzZU5hbWV9KSxcbiAgICBuZXcgT3Bmc1BlcnNpc3RlbmNlKHtkYXRhYmFzZU5hbWUsIGVudmlyb25tZW50fSksXG4gICAgbmV3IEluZGV4ZWREYlBlcnNpc3RlbmNlKHtkYXRhYmFzZU5hbWUsIGVudmlyb25tZW50fSlcbiAgXVxuXG4gIGZvciAoY29uc3QgcGVyc2lzdGVuY2Ugb2YgcGVyc2lzdGVuY2VzKSBhd2FpdCBkZWxldGVQZXJzaXN0ZW5jZUlmQXZhaWxhYmxlKHBlcnNpc3RlbmNlKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGxlZ2FjeSBTUUxpdGUgd2ViIHN0b3JhZ2Uga2V5IGZvciBhIGRhdGFiYXNlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUGVyc2lzdGVuY2Uga2V5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3FsaXRlV2ViUGVyc2lzdGVuY2VLZXkoZGF0YWJhc2VOYW1lKSB7XG4gIGlmICghZGF0YWJhc2VOYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBuYW1lIGdpdmVuIGluIGFyZ3VtZW50cyBmb3IgU1FMaXRlIFdlYiBkYXRhYmFzZVwiKVxuXG4gIHJldHVybiBgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlV2ViLS0tJHtkYXRhYmFzZU5hbWV9YFxufVxuXG4vKiogT1BGUy1iYWNrZWQgU1FMLmpzIGRhdGFiYXNlIGZpbGUgcGVyc2lzdGVuY2UuICovXG5jbGFzcyBPcGZzUGVyc2lzdGVuY2Uge1xuICAvKiogQHR5cGUge1wib3Bmc1wifSAqL1xuICBuYW1lID0gXCJvcGZzXCJcblxuICAvKipcbiAgICogQ3JlYXRlcyBPUEZTIHBlcnNpc3RlbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtTcWxpdGVXZWJQZXJzaXN0ZW5jZUVudmlyb25tZW50fSBhcmdzLmVudmlyb25tZW50IC0gQnJvd3Nlci1saWtlIGVudmlyb25tZW50LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2RhdGFiYXNlTmFtZSwgZW52aXJvbm1lbnR9KSB7XG4gICAgdGhpcy5kYXRhYmFzZU5hbWUgPSBkYXRhYmFzZU5hbWVcbiAgICB0aGlzLmVudmlyb25tZW50ID0gZW52aXJvbm1lbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIHRoZSBPUEZTIGRhdGFiYXNlIGZpbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZGVsZXRlZC5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZSgpIHtcbiAgICBjb25zdCBkaXJlY3RvcnkgPSBhd2FpdCBvcGZzRGlyZWN0b3J5KHRoaXMuZW52aXJvbm1lbnQpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZGlyZWN0b3J5LnJlbW92ZUVudHJ5KHNxbGl0ZVdlYlBlcnNpc3RlbmNlS2V5KHRoaXMuZGF0YWJhc2VOYW1lKSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFpc05vdEZvdW5kRXJyb3IoZXJyb3IpKSB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgT1BGUyBkYXRhYmFzZSBmaWxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxVaW50OEFycmF5IHwgdW5kZWZpbmVkPn0gLSBQZXJzaXN0ZWQgYnl0ZXMuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIGNvbnN0IGRpcmVjdG9yeSA9IGF3YWl0IG9wZnNEaXJlY3RvcnkodGhpcy5lbnZpcm9ubWVudClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBmaWxlSGFuZGxlID0gYXdhaXQgZGlyZWN0b3J5LmdldEZpbGVIYW5kbGUoc3FsaXRlV2ViUGVyc2lzdGVuY2VLZXkodGhpcy5kYXRhYmFzZU5hbWUpKVxuICAgICAgY29uc3QgZmlsZSA9IGF3YWl0IGZpbGVIYW5kbGUuZ2V0RmlsZSgpXG4gICAgICBjb25zdCBhcnJheUJ1ZmZlciA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKVxuXG4gICAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYXJyYXlCdWZmZXIpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChpc05vdEZvdW5kRXJyb3IoZXJyb3IpKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIHRoZSBPUEZTIGRhdGFiYXNlIGZpbGUgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGNvbnRlbnQgZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgZXhpc3RzKCkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gKGF3YWl0IHRoaXMubG9hZCgpKSAhPT0gdW5kZWZpbmVkXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2F2ZXMgZGF0YWJhc2UgYnl0ZXMuXG4gICAqIEBwYXJhbSB7VWludDhBcnJheX0gY29udGVudCAtIERhdGFiYXNlIGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNhdmVkLlxuICAgKi9cbiAgYXN5bmMgc2F2ZShjb250ZW50KSB7XG4gICAgY29uc3QgZGlyZWN0b3J5ID0gYXdhaXQgb3Bmc0RpcmVjdG9yeSh0aGlzLmVudmlyb25tZW50KVxuICAgIGNvbnN0IGZpbGVIYW5kbGUgPSBhd2FpdCBkaXJlY3RvcnkuZ2V0RmlsZUhhbmRsZShzcWxpdGVXZWJQZXJzaXN0ZW5jZUtleSh0aGlzLmRhdGFiYXNlTmFtZSksIHtjcmVhdGU6IHRydWV9KVxuICAgIGNvbnN0IHdyaXRhYmxlID0gYXdhaXQgZmlsZUhhbmRsZS5jcmVhdGVXcml0YWJsZSgpXG5cbiAgICBhd2FpdCB3cml0YWJsZS53cml0ZShhcnJheUJ1ZmZlckZyb21CeXRlcyhjb250ZW50KSlcbiAgICBhd2FpdCB3cml0YWJsZS5jbG9zZSgpXG4gIH1cbn1cblxuLyoqIEluZGV4ZWREQi1iYWNrZWQgU1FMLmpzIGRhdGFiYXNlIGJsb2IgcGVyc2lzdGVuY2UuICovXG5jbGFzcyBJbmRleGVkRGJQZXJzaXN0ZW5jZSB7XG4gIC8qKiBAdHlwZSB7XCJpbmRleGVkZGJcIn0gKi9cbiAgbmFtZSA9IFwiaW5kZXhlZGRiXCJcblxuICAvKipcbiAgICogQ3JlYXRlcyBJbmRleGVkREIgcGVyc2lzdGVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge1NxbGl0ZVdlYlBlcnNpc3RlbmNlRW52aXJvbm1lbnR9IGFyZ3MuZW52aXJvbm1lbnQgLSBCcm93c2VyLWxpa2UgZW52aXJvbm1lbnQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7ZGF0YWJhc2VOYW1lLCBlbnZpcm9ubWVudH0pIHtcbiAgICB0aGlzLmRhdGFiYXNlTmFtZSA9IGRhdGFiYXNlTmFtZVxuICAgIHRoaXMuZW52aXJvbm1lbnQgPSBlbnZpcm9ubWVudFxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgdGhlIEluZGV4ZWREQiBkYXRhYmFzZSBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlKCkge1xuICAgIGNvbnN0IGRhdGFiYXNlID0gYXdhaXQgb3BlbkluZGV4ZWREYih0aGlzLmVudmlyb25tZW50KVxuXG4gICAgYXdhaXQgaW5kZXhlZERiUmVxdWVzdChkYXRhYmFzZS50cmFuc2FjdGlvbihcImRhdGFiYXNlc1wiLCBcInJlYWR3cml0ZVwiKS5vYmplY3RTdG9yZShcImRhdGFiYXNlc1wiKS5kZWxldGUoc3FsaXRlV2ViUGVyc2lzdGVuY2VLZXkodGhpcy5kYXRhYmFzZU5hbWUpKSlcbiAgICBkYXRhYmFzZS5jbG9zZSgpXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgdGhlIEluZGV4ZWREQiBkYXRhYmFzZSBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8VWludDhBcnJheSB8IHVuZGVmaW5lZD59IC0gUGVyc2lzdGVkIGJ5dGVzLlxuICAgKi9cbiAgYXN5bmMgbG9hZCgpIHtcbiAgICBjb25zdCBkYXRhYmFzZSA9IGF3YWl0IG9wZW5JbmRleGVkRGIodGhpcy5lbnZpcm9ubWVudClcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBpbmRleGVkRGJSZXF1ZXN0KGRhdGFiYXNlLnRyYW5zYWN0aW9uKFwiZGF0YWJhc2VzXCIsIFwicmVhZG9ubHlcIikub2JqZWN0U3RvcmUoXCJkYXRhYmFzZXNcIikuZ2V0KHNxbGl0ZVdlYlBlcnNpc3RlbmNlS2V5KHRoaXMuZGF0YWJhc2VOYW1lKSkpXG5cbiAgICBkYXRhYmFzZS5jbG9zZSgpXG5cbiAgICBpZiAocmVzdWx0ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWRcbiAgICBpZiAocmVzdWx0IGluc3RhbmNlb2YgVWludDhBcnJheSkgcmV0dXJuIHJlc3VsdFxuICAgIGlmIChyZXN1bHQgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikgcmV0dXJuIG5ldyBVaW50OEFycmF5KHJlc3VsdClcblxuICAgIHRocm93IG5ldyBFcnJvcihcIlNRTGl0ZSB3ZWIgSW5kZXhlZERCIHBlcnNpc3RlbmNlIHJldHVybmVkIHVuc3VwcG9ydGVkIGNvbnRlbnRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciB0aGUgSW5kZXhlZERCIGRhdGFiYXNlIGVudHJ5IGV4aXN0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBjb250ZW50IGV4aXN0cy5cbiAgICovXG4gIGFzeW5jIGV4aXN0cygpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZGF0YWJhc2UgPSBhd2FpdCBvcGVuSW5kZXhlZERiKHRoaXMuZW52aXJvbm1lbnQpXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBpbmRleGVkRGJSZXF1ZXN0KGRhdGFiYXNlLnRyYW5zYWN0aW9uKFwiZGF0YWJhc2VzXCIsIFwicmVhZG9ubHlcIikub2JqZWN0U3RvcmUoXCJkYXRhYmFzZXNcIikuZ2V0KHNxbGl0ZVdlYlBlcnNpc3RlbmNlS2V5KHRoaXMuZGF0YWJhc2VOYW1lKSkpXG5cbiAgICAgIGRhdGFiYXNlLmNsb3NlKClcblxuICAgICAgcmV0dXJuIHJlc3VsdCAhPT0gdW5kZWZpbmVkICYmIHJlc3VsdCAhPT0gbnVsbFxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNhdmVzIGRhdGFiYXNlIGJ5dGVzLlxuICAgKiBAcGFyYW0ge1VpbnQ4QXJyYXl9IGNvbnRlbnQgLSBEYXRhYmFzZSBieXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzYXZlZC5cbiAgICovXG4gIGFzeW5jIHNhdmUoY29udGVudCkge1xuICAgIGNvbnN0IGRhdGFiYXNlID0gYXdhaXQgb3BlbkluZGV4ZWREYih0aGlzLmVudmlyb25tZW50KVxuXG4gICAgYXdhaXQgaW5kZXhlZERiUmVxdWVzdChkYXRhYmFzZS50cmFuc2FjdGlvbihcImRhdGFiYXNlc1wiLCBcInJlYWR3cml0ZVwiKS5vYmplY3RTdG9yZShcImRhdGFiYXNlc1wiKS5wdXQoY29udGVudCwgc3FsaXRlV2ViUGVyc2lzdGVuY2VLZXkodGhpcy5kYXRhYmFzZU5hbWUpKSlcbiAgICBkYXRhYmFzZS5jbG9zZSgpXG4gIH1cbn1cblxuLyoqIExvY2FsU3RvcmFnZS1iYWNrZWQgU1FMLmpzIGRhdGFiYXNlIGJsb2IgcGVyc2lzdGVuY2UgZm9yIGxlZ2FjeSBtaWdyYXRpb25zLiAqL1xuY2xhc3MgTG9jYWxTdG9yYWdlUGVyc2lzdGVuY2Uge1xuXG4gIC8qKiBAdHlwZSB7XCJsb2NhbHN0b3JhZ2VcIn0gKi9cbiAgbmFtZSA9IFwibG9jYWxzdG9yYWdlXCJcblxuICAvKipcbiAgICogQ3JlYXRlcyBsb2NhbFN0b3JhZ2UgcGVyc2lzdGVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2RhdGFiYXNlTmFtZX0pIHtcbiAgICB0aGlzLmRhdGFiYXNlTmFtZSA9IGRhdGFiYXNlTmFtZVxuICAgIC8qKiBAdHlwZSB7QmV0dGVyTG9jYWxTdG9yYWdlIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RvcmFnZSA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgdGhlIGxvY2FsU3RvcmFnZSBkYXRhYmFzZSBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlKCkge1xuICAgIGF3YWl0IHRoaXMubG9jYWxTdG9yYWdlKCkuZGVsZXRlKHNxbGl0ZVdlYlBlcnNpc3RlbmNlS2V5KHRoaXMuZGF0YWJhc2VOYW1lKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgbG9jYWxTdG9yYWdlIGRhdGFiYXNlIGVudHJ5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxVaW50OEFycmF5IHwgdW5kZWZpbmVkPn0gLSBQZXJzaXN0ZWQgYnl0ZXMuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmxvY2FsU3RvcmFnZSgpLmdldChzcWxpdGVXZWJQZXJzaXN0ZW5jZUtleSh0aGlzLmRhdGFiYXNlTmFtZSkpXG5cbiAgICBpZiAoY29udGVudCA9PT0gbnVsbCB8fCBjb250ZW50ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWRcbiAgICBpZiAoY29udGVudCBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkpIHJldHVybiBjb250ZW50XG4gICAgaWYgKGNvbnRlbnQgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikgcmV0dXJuIG5ldyBVaW50OEFycmF5KGNvbnRlbnQpXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtVaW50OEFycmF5fSAqLyAoY29udGVudClcbiAgfVxuXG4gIC8qKlxuICAgKiBTYXZlcyBkYXRhYmFzZSBieXRlcy5cbiAgICogQHBhcmFtIHtVaW50OEFycmF5fSBjb250ZW50IC0gRGF0YWJhc2UgYnl0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2F2ZWQuXG4gICAqL1xuICBhc3luYyBzYXZlKGNvbnRlbnQpIHtcbiAgICBhd2FpdCB0aGlzLmxvY2FsU3RvcmFnZSgpLnNldChzcWxpdGVXZWJQZXJzaXN0ZW5jZUtleSh0aGlzLmRhdGFiYXNlTmFtZSksIGNvbnRlbnQpXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgdGhlIGxlZ2FjeSBsb2NhbFN0b3JhZ2UgZGF0YWJhc2UgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGNvbnRlbnQgZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgZXhpc3RzKCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5sb2NhbFN0b3JhZ2UoKS5nZXQoc3FsaXRlV2ViUGVyc2lzdGVuY2VLZXkodGhpcy5kYXRhYmFzZU5hbWUpKVxuXG4gICAgICByZXR1cm4gY29udGVudCAhPT0gdW5kZWZpbmVkICYmIGNvbnRlbnQgIT09IG51bGxcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsb2NhbFN0b3JhZ2Ugd3JhcHBlci5cbiAgICogQHJldHVybnMge0JldHRlckxvY2FsU3RvcmFnZX0gLSBTdG9yYWdlIHdyYXBwZXIuXG4gICAqL1xuICBsb2NhbFN0b3JhZ2UoKSB7XG4gICAgdGhpcy5zdG9yYWdlIHx8PSBuZXcgQmV0dGVyTG9jYWxTdG9yYWdlKClcblxuICAgIHJldHVybiB0aGlzLnN0b3JhZ2VcbiAgfVxufVxuXG4vKipcbiAqIFNlbGVjdHMgdGhlIHByZWZlcnJlZCBhdmFpbGFibGUgU1FMaXRlIHdlYiBwZXJzaXN0ZW5jZSBiYWNrZW5kLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge1NxbGl0ZVdlYlBlcnNpc3RlbmNlRW52aXJvbm1lbnR9IGFyZ3MuZW52aXJvbm1lbnQgLSBCcm93c2VyLWxpa2UgZW52aXJvbm1lbnQuXG4gKiBAcGFyYW0ge0luZGV4ZWREYlBlcnNpc3RlbmNlfSBhcmdzLmluZGV4ZWREYlBlcnNpc3RlbmNlIC0gSW5kZXhlZERCIHBlcnNpc3RlbmNlIGFkYXB0ZXIuXG4gKiBAcGFyYW0ge0xvY2FsU3RvcmFnZVBlcnNpc3RlbmNlfSBhcmdzLmxvY2FsU3RvcmFnZVBlcnNpc3RlbmNlIC0gTGVnYWN5IGxvY2FsU3RvcmFnZSBwZXJzaXN0ZW5jZSBhZGFwdGVyLlxuICogQHBhcmFtIHtPcGZzUGVyc2lzdGVuY2V9IGFyZ3Mub3Bmc1BlcnNpc3RlbmNlIC0gT1BGUyBwZXJzaXN0ZW5jZSBhZGFwdGVyLlxuICogQHJldHVybnMge1Byb21pc2U8U3FsaXRlV2ViUGVyc2lzdGVuY2U+fSAtIFNlbGVjdGVkIHBlcnNpc3RlbmNlIGFkYXB0ZXIuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHNlbGVjdFN1cHBvcnRlZFBlcnNpc3RlbmNlKHtlbnZpcm9ubWVudCwgaW5kZXhlZERiUGVyc2lzdGVuY2UsIGxvY2FsU3RvcmFnZVBlcnNpc3RlbmNlLCBvcGZzUGVyc2lzdGVuY2V9KSB7XG4gIGlmIChhd2FpdCBzdXBwb3J0c09wZnNQZXJzaXN0ZW5jZShlbnZpcm9ubWVudCkpIHJldHVybiBvcGZzUGVyc2lzdGVuY2VcbiAgaWYgKGF3YWl0IHN1cHBvcnRzSW5kZXhlZERiUGVyc2lzdGVuY2UoZW52aXJvbm1lbnQpKSByZXR1cm4gaW5kZXhlZERiUGVyc2lzdGVuY2VcblxuICByZXR1cm4gbG9jYWxTdG9yYWdlUGVyc2lzdGVuY2Vcbn1cblxuLyoqXG4gKiBNaWdyYXRlcyBhbnkgZXhpc3RpbmcgZGF0YWJhc2UgYnl0ZXMgaW50byB0aGUgc2VsZWN0ZWQgcGVyc2lzdGVuY2UgYmFja2VuZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAqIEBwYXJhbSB7U3FsaXRlV2ViUGVyc2lzdGVuY2V9IGFyZ3MuZGVzdGluYXRpb25QZXJzaXN0ZW5jZSAtIFNlbGVjdGVkIHBlcnNpc3RlbmNlIGFkYXB0ZXIuXG4gKiBAcGFyYW0ge1NxbGl0ZVdlYlBlcnNpc3RlbmNlRW52aXJvbm1lbnR9IGFyZ3MuZW52aXJvbm1lbnQgLSBCcm93c2VyLWxpa2UgZW52aXJvbm1lbnQuXG4gKiBAcGFyYW0ge3tkZWxldGU6ICgpID0+IFByb21pc2U8dm9pZD4sIGxvYWQ6ICgpID0+IFByb21pc2U8VWludDhBcnJheSB8IHVuZGVmaW5lZD59W119IGFyZ3Muc291cmNlUGVyc2lzdGVuY2VzIC0gUGVyc2lzdGVuY2UgYWRhcHRlcnMgdG8gc2NhbiBmb3IgZXhpc3RpbmcgYnl0ZXMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIG1pZ3JhdGlvbiBpcyBjb21wbGV0ZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gbWlncmF0ZVBlcnNpc3RlZERhdGFiYXNlKHtkYXRhYmFzZU5hbWUsIGRlc3RpbmF0aW9uUGVyc2lzdGVuY2UsIGVudmlyb25tZW50LCBzb3VyY2VQZXJzaXN0ZW5jZXN9KSB7XG4gIGlmIChhd2FpdCBkZXN0aW5hdGlvblBlcnNpc3RlbmNlLmxvYWQoKSAhPT0gdW5kZWZpbmVkKSByZXR1cm5cblxuICBmb3IgKGNvbnN0IHNvdXJjZVBlcnNpc3RlbmNlIG9mIHNvdXJjZVBlcnNpc3RlbmNlcykge1xuICAgIGlmIChzb3VyY2VQZXJzaXN0ZW5jZSA9PT0gZGVzdGluYXRpb25QZXJzaXN0ZW5jZSkgY29udGludWVcblxuICAgIGNvbnN0IGRhdGFiYXNlQnl0ZXMgPSBhd2FpdCBsb2FkUGVyc2lzdGVuY2VJZkF2YWlsYWJsZShzb3VyY2VQZXJzaXN0ZW5jZSlcbiAgICBpZiAoZGF0YWJhc2VCeXRlcyA9PT0gdW5kZWZpbmVkKSBjb250aW51ZVxuXG4gICAgYXdhaXQgZGVzdGluYXRpb25QZXJzaXN0ZW5jZS5zYXZlKGRhdGFiYXNlQnl0ZXMpXG4gICAgYXdhaXQgZGVsZXRlU3FsaXRlV2ViUGVyc2lzdGVuY2VzKHtkYXRhYmFzZU5hbWUsIGVudmlyb25tZW50fSlcbiAgICBhd2FpdCBkZXN0aW5hdGlvblBlcnNpc3RlbmNlLnNhdmUoZGF0YWJhc2VCeXRlcylcbiAgICByZXR1cm5cbiAgfVxufVxuXG4vKipcbiAqIExvYWRzIGEgcGVyc2lzdGVuY2UgYmFja2VuZCwgaWdub3JpbmcgdW5hdmFpbGFibGUgYmFja2VuZCBlcnJvcnMuXG4gKiBAcGFyYW0ge3tsb2FkOiAoKSA9PiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+fX0gcGVyc2lzdGVuY2UgLSBQZXJzaXN0ZW5jZSBhZGFwdGVyLlxuICogQHJldHVybnMge1Byb21pc2U8VWludDhBcnJheSB8IHVuZGVmaW5lZD59IC0gUGVyc2lzdGVkIGJ5dGVzLCBpZiBhdmFpbGFibGUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGxvYWRQZXJzaXN0ZW5jZUlmQXZhaWxhYmxlKHBlcnNpc3RlbmNlKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGF3YWl0IHBlcnNpc3RlbmNlLmxvYWQoKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cbn1cblxuLyoqXG4gKiBUZXN0cyB3aGV0aGVyIE9QRlMgcGVyc2lzdGVuY2UgaXMgdXNhYmxlLlxuICogQHBhcmFtIHtTcWxpdGVXZWJQZXJzaXN0ZW5jZUVudmlyb25tZW50fSBlbnZpcm9ubWVudCAtIEJyb3dzZXItbGlrZSBlbnZpcm9ubWVudC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgT1BGUyBjYW4gYmUgdXNlZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gc3VwcG9ydHNPcGZzUGVyc2lzdGVuY2UoZW52aXJvbm1lbnQpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBkaXJlY3RvcnkgPSBhd2FpdCBvcGZzRGlyZWN0b3J5KGVudmlyb25tZW50KVxuICAgIGNvbnN0IGZpbGVIYW5kbGUgPSBhd2FpdCBkaXJlY3RvcnkuZ2V0RmlsZUhhbmRsZShTVVBQT1JUX0NIRUNLX0ZJTEUsIHtjcmVhdGU6IHRydWV9KVxuICAgIGNvbnN0IHdyaXRhYmxlID0gYXdhaXQgZmlsZUhhbmRsZS5jcmVhdGVXcml0YWJsZSgpXG5cbiAgICBhd2FpdCB3cml0YWJsZS53cml0ZShhcnJheUJ1ZmZlckZyb21CeXRlcyhTVVBQT1JUX0NIRUNLX0JZVEVTKSlcbiAgICBhd2FpdCB3cml0YWJsZS5jbG9zZSgpXG5cbiAgICBjb25zdCBmaWxlID0gYXdhaXQgZmlsZUhhbmRsZS5nZXRGaWxlKClcbiAgICBjb25zdCByZWFkQmFjayA9IG5ldyBVaW50OEFycmF5KGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKSlcblxuICAgIGF3YWl0IGRpcmVjdG9yeS5yZW1vdmVFbnRyeShTVVBQT1JUX0NIRUNLX0ZJTEUpXG5cbiAgICByZXR1cm4gc2FtZUJ5dGVzKHJlYWRCYWNrLCBTVVBQT1JUX0NIRUNLX0JZVEVTKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG4vKipcbiAqIFRlc3RzIHdoZXRoZXIgSW5kZXhlZERCIHBlcnNpc3RlbmNlIGlzIHVzYWJsZS5cbiAqIEBwYXJhbSB7U3FsaXRlV2ViUGVyc2lzdGVuY2VFbnZpcm9ubWVudH0gZW52aXJvbm1lbnQgLSBCcm93c2VyLWxpa2UgZW52aXJvbm1lbnQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIEluZGV4ZWREQiBjYW4gYmUgdXNlZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gc3VwcG9ydHNJbmRleGVkRGJQZXJzaXN0ZW5jZShlbnZpcm9ubWVudCkge1xuICB0cnkge1xuICAgIGNvbnN0IGRhdGFiYXNlID0gYXdhaXQgb3BlbkluZGV4ZWREYihlbnZpcm9ubWVudClcbiAgICBjb25zdCBzdG9yZSA9IGRhdGFiYXNlLnRyYW5zYWN0aW9uKFwiZGF0YWJhc2VzXCIsIFwicmVhZHdyaXRlXCIpLm9iamVjdFN0b3JlKFwiZGF0YWJhc2VzXCIpXG5cbiAgICBhd2FpdCBpbmRleGVkRGJSZXF1ZXN0KHN0b3JlLnB1dChTVVBQT1JUX0NIRUNLX0JZVEVTLCBTVVBQT1JUX0NIRUNLX0ZJTEUpKVxuXG4gICAgY29uc3QgcmVhZEJhY2sgPSBhd2FpdCBpbmRleGVkRGJSZXF1ZXN0KHN0b3JlLmdldChTVVBQT1JUX0NIRUNLX0ZJTEUpKVxuXG4gICAgYXdhaXQgaW5kZXhlZERiUmVxdWVzdChzdG9yZS5kZWxldGUoU1VQUE9SVF9DSEVDS19GSUxFKSlcbiAgICBkYXRhYmFzZS5jbG9zZSgpXG5cbiAgICByZXR1cm4gcmVhZEJhY2sgaW5zdGFuY2VvZiBVaW50OEFycmF5ICYmIHNhbWVCeXRlcyhyZWFkQmFjaywgU1VQUE9SVF9DSEVDS19CWVRFUylcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuLyoqXG4gKiBPcGVucyB0aGUgU1FMaXRlIHdlYiBJbmRleGVkREIgZGF0YWJhc2UuXG4gKiBAcGFyYW0ge1NxbGl0ZVdlYlBlcnNpc3RlbmNlRW52aXJvbm1lbnR9IGVudmlyb25tZW50IC0gQnJvd3Nlci1saWtlIGVudmlyb25tZW50LlxuICogQHJldHVybnMge1Byb21pc2U8SURCRGF0YWJhc2U+fSAtIE9wZW4gZGF0YWJhc2UuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIG9wZW5JbmRleGVkRGIoZW52aXJvbm1lbnQpIHtcbiAgY29uc3QgaW5kZXhlZERiID0gaW5kZXhlZERiRnJvbUVudmlyb25tZW50KGVudmlyb25tZW50KVxuXG4gIGlmICghaW5kZXhlZERiIHx8IHR5cGVvZiBpbmRleGVkRGIub3BlbiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJJbmRleGVkREIgaXMgbm90IGF2YWlsYWJsZVwiKVxuXG4gIGNvbnN0IHJlcXVlc3QgPSBpbmRleGVkRGIub3BlbihcIlZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1NxbGl0ZVdlYlwiLCAxKVxuICByZXF1ZXN0Lm9udXBncmFkZW5lZWRlZCA9ICgpID0+IHtcbiAgICBjb25zdCBkYXRhYmFzZSA9IHJlcXVlc3QucmVzdWx0XG5cbiAgICBpZiAoIWRhdGFiYXNlLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoXCJkYXRhYmFzZXNcIikpIGRhdGFiYXNlLmNyZWF0ZU9iamVjdFN0b3JlKFwiZGF0YWJhc2VzXCIpXG4gIH1cblxuICByZXR1cm4gYXdhaXQgaW5kZXhlZERiUmVxdWVzdChyZXF1ZXN0KVxufVxuXG4vKipcbiAqIFJlc29sdmVzIGFuIEluZGV4ZWREQiByZXF1ZXN0LlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7SURCUmVxdWVzdDxUPn0gcmVxdWVzdCAtIEluZGV4ZWREQiByZXF1ZXN0LlxuICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVxdWVzdCByZXN1bHQuXG4gKi9cbmZ1bmN0aW9uIGluZGV4ZWREYlJlcXVlc3QocmVxdWVzdCkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIHJlcXVlc3Qub25zdWNjZXNzID0gKCkgPT4gcmVzb2x2ZShyZXF1ZXN0LnJlc3VsdClcbiAgICByZXF1ZXN0Lm9uZXJyb3IgPSAoKSA9PiByZWplY3QocmVxdWVzdC5lcnJvciB8fCBuZXcgRXJyb3IoXCJJbmRleGVkREIgcmVxdWVzdCBmYWlsZWRcIikpXG4gIH0pXG59XG5cbi8qKlxuICogRGVsZXRlcyBhIHBlcnNpc3RlbmNlIGJhY2tlbmQsIGlnbm9yaW5nIHVuYXZhaWxhYmxlIGJhY2tlbmQgZXJyb3JzLlxuICogQHBhcmFtIHt7ZGVsZXRlOiAoKSA9PiBQcm9taXNlPHZvaWQ+fX0gcGVyc2lzdGVuY2UgLSBQZXJzaXN0ZW5jZSBhZGFwdGVyLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGlvbiB3YXMgYXR0ZW1wdGVkLlxuICovXG5hc3luYyBmdW5jdGlvbiBkZWxldGVQZXJzaXN0ZW5jZUlmQXZhaWxhYmxlKHBlcnNpc3RlbmNlKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgcGVyc2lzdGVuY2UuZGVsZXRlKClcbiAgfSBjYXRjaCB7XG4gICAgLy8gSWdub3JlIHVuYXZhaWxhYmxlIGJhY2tlbmRzIHNvIHJlc2V0IGNsZWFycyBldmVyeSBiYWNrZW5kIHRoZSBicm93c2VyIGNhbiBhY2Nlc3MuXG4gIH1cbn1cblxuLyoqXG4gKiBHZXRzIE9QRlMgcm9vdCBkaXJlY3RvcnkuXG4gKiBAcGFyYW0ge1NxbGl0ZVdlYlBlcnNpc3RlbmNlRW52aXJvbm1lbnR9IGVudmlyb25tZW50IC0gQnJvd3Nlci1saWtlIGVudmlyb25tZW50LlxuICogQHJldHVybnMge1Byb21pc2U8RmlsZVN5c3RlbURpcmVjdG9yeUhhbmRsZT59IC0gT1BGUyByb290IGRpcmVjdG9yeS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gb3Bmc0RpcmVjdG9yeShlbnZpcm9ubWVudCkge1xuICBjb25zdCBuYXZpZ2F0b3JPYmplY3QgPSBuYXZpZ2F0b3JGcm9tRW52aXJvbm1lbnQoZW52aXJvbm1lbnQpXG4gIGNvbnN0IHN0b3JhZ2UgPSBuYXZpZ2F0b3JPYmplY3Quc3RvcmFnZVxuXG4gIGlmICghc3RvcmFnZSB8fCB0eXBlb2Ygc3RvcmFnZS5nZXREaXJlY3RvcnkgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiT1BGUyBpcyBub3QgYXZhaWxhYmxlXCIpXG5cbiAgcmV0dXJuIGF3YWl0IHN0b3JhZ2UuZ2V0RGlyZWN0b3J5KClcbn1cblxuLyoqXG4gKiBHZXRzIG5hdmlnYXRvciBmcm9tIGVudmlyb25tZW50LlxuICogQHBhcmFtIHtTcWxpdGVXZWJQZXJzaXN0ZW5jZUVudmlyb25tZW50fSBlbnZpcm9ubWVudCAtIEJyb3dzZXItbGlrZSBlbnZpcm9ubWVudC5cbiAqIEByZXR1cm5zIHt7c3RvcmFnZT86IHtnZXREaXJlY3Rvcnk/OiAoKSA9PiBQcm9taXNlPEZpbGVTeXN0ZW1EaXJlY3RvcnlIYW5kbGU+fX19IC0gTmF2aWdhdG9yLWxpa2Ugb2JqZWN0LlxuICovXG5mdW5jdGlvbiBuYXZpZ2F0b3JGcm9tRW52aXJvbm1lbnQoZW52aXJvbm1lbnQpIHtcbiAgY29uc3QgY2FuZGlkYXRlID0gZW52aXJvbm1lbnQubmF2aWdhdG9yXG5cbiAgaWYgKCFjYW5kaWRhdGUgfHwgdHlwZW9mIGNhbmRpZGF0ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIHt9XG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7e3N0b3JhZ2U/OiB7Z2V0RGlyZWN0b3J5PzogKCkgPT4gUHJvbWlzZTxGaWxlU3lzdGVtRGlyZWN0b3J5SGFuZGxlPn19fSAqLyAoY2FuZGlkYXRlKVxufVxuXG4vKipcbiAqIEdldHMgSW5kZXhlZERCIGZyb20gZW52aXJvbm1lbnQuXG4gKiBAcGFyYW0ge1NxbGl0ZVdlYlBlcnNpc3RlbmNlRW52aXJvbm1lbnR9IGVudmlyb25tZW50IC0gQnJvd3Nlci1saWtlIGVudmlyb25tZW50LlxuICogQHJldHVybnMge3tvcGVuPzogKG5hbWU6IHN0cmluZywgdmVyc2lvbj86IG51bWJlcikgPT4gSURCT3BlbkRCUmVxdWVzdH0gfCB1bmRlZmluZWR9IC0gSW5kZXhlZERCLWxpa2Ugb2JqZWN0LlxuICovXG5mdW5jdGlvbiBpbmRleGVkRGJGcm9tRW52aXJvbm1lbnQoZW52aXJvbm1lbnQpIHtcbiAgY29uc3QgY2FuZGlkYXRlID0gZW52aXJvbm1lbnQuaW5kZXhlZERCXG5cbiAgaWYgKCFjYW5kaWRhdGUgfHwgdHlwZW9mIGNhbmRpZGF0ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIHJldHVybiAvKiogQHR5cGUge3tvcGVuPzogKG5hbWU6IHN0cmluZywgdmVyc2lvbj86IG51bWJlcikgPT4gSURCT3BlbkRCUmVxdWVzdH19ICovIChjYW5kaWRhdGUpXG59XG5cbi8qKlxuICogQ29udmVydHMgYnl0ZXMgdG8gYSBzdGFuZGFsb25lIEFycmF5QnVmZmVyIGZvciBicm93c2VyIGZpbGUgd3JpdGVzLlxuICogQHBhcmFtIHtVaW50OEFycmF5fSBieXRlcyAtIEJ5dGVzIHRvIGNvbnZlcnQuXG4gKiBAcmV0dXJucyB7QXJyYXlCdWZmZXJ9IC0gU3RhbmRhbG9uZSBBcnJheUJ1ZmZlci5cbiAqL1xuZnVuY3Rpb24gYXJyYXlCdWZmZXJGcm9tQnl0ZXMoYnl0ZXMpIHtcbiAgY29uc3QgY29weSA9IG5ldyBVaW50OEFycmF5KGJ5dGVzLmJ5dGVMZW5ndGgpXG5cbiAgY29weS5zZXQoYnl0ZXMpXG5cbiAgcmV0dXJuIGNvcHkuYnVmZmVyXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gZXJyb3IgaXMgYSBmaWxlLW5vdC1mb3VuZCBlcnJvci5cbiAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBFcnJvciBjYW5kaWRhdGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBlcnJvciBpcyBub3QgZm91bmQuXG4gKi9cbmZ1bmN0aW9uIGlzTm90Rm91bmRFcnJvcihlcnJvcikge1xuICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5uYW1lID09PSBcIk5vdEZvdW5kRXJyb3JcIlxufVxuXG4vKipcbiAqIENvbXBhcmVzIHR3byBieXRlIGFycmF5cy5cbiAqIEBwYXJhbSB7VWludDhBcnJheX0gbGVmdCAtIExlZnQgYnl0ZXMuXG4gKiBAcGFyYW0ge1VpbnQ4QXJyYXl9IHJpZ2h0IC0gUmlnaHQgYnl0ZXMuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGJ5dGVzIG1hdGNoLlxuICovXG5mdW5jdGlvbiBzYW1lQnl0ZXMobGVmdCwgcmlnaHQpIHtcbiAgaWYgKGxlZnQubGVuZ3RoICE9PSByaWdodC5sZW5ndGgpIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiBsZWZ0LmV2ZXJ5KCh2YWx1ZSwgaW5kZXgpID0+IHZhbHVlID09PSByaWdodFtpbmRleF0pXG59XG4iXX0=