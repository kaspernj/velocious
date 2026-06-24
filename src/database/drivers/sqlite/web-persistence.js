// @ts-check

import BetterLocalStorage from "better-localstorage"

const SUPPORT_CHECK_FILE = ".velocious-opfs-support-check"
const SUPPORT_CHECK_BYTES = new Uint8Array([118, 101, 108, 111, 99, 105, 111, 117, 115])

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

/**
 * Creates the best SQLite web persistence adapter supported by the current browser.
 * @param {object} args - Arguments.
 * @param {string} args.databaseName - Database name.
 * @param {SqliteWebPersistenceEnvironment} [args.environment] - Browser-like environment.
 * @returns {Promise<SqliteWebPersistence>} - Selected persistence adapter.
 */
export async function createSqliteWebPersistence({databaseName, environment = globalThis}) {
  const localStoragePersistence = new LocalStoragePersistence({databaseName})
  const opfsPersistence = new OpfsPersistence({databaseName, environment})
  const indexedDbPersistence = new IndexedDbPersistence({databaseName, environment})

  const selectedPersistence = await selectSupportedPersistence({environment, indexedDbPersistence, localStoragePersistence, opfsPersistence})

  await migratePersistedDatabase({
    databaseName,
    destinationPersistence: selectedPersistence,
    environment,
    sourcePersistences: [localStoragePersistence, indexedDbPersistence, opfsPersistence]
  })

  return selectedPersistence
}

/**
 * Deletes SQLite web database bytes from every available persistence backend.
 * @param {object} args - Arguments.
 * @param {string} args.databaseName - Database name.
 * @param {SqliteWebPersistenceEnvironment} [args.environment] - Browser-like environment.
 * @returns {Promise<void>} - Resolves when all available backends were cleared.
 */
export async function deleteSqliteWebPersistences({databaseName, environment = globalThis}) {
  const persistences = [
    new LocalStoragePersistence({databaseName}),
    new OpfsPersistence({databaseName, environment}),
    new IndexedDbPersistence({databaseName, environment})
  ]

  for (const persistence of persistences) await deletePersistenceIfAvailable(persistence)
}

/**
 * Returns the legacy SQLite web storage key for a database name.
 * @param {string} databaseName - Database name.
 * @returns {string} - Persistence key.
 */
export function sqliteWebPersistenceKey(databaseName) {
  if (!databaseName) throw new Error("No name given in arguments for SQLite Web database")

  return `VelociousDatabaseDriversSqliteWeb---${databaseName}`
}

/** OPFS-backed SQL.js database file persistence. */
class OpfsPersistence {
  /** @type {"opfs"} */
  name = "opfs"

  /**
   * Creates OPFS persistence.
   * @param {object} args - Arguments.
   * @param {string} args.databaseName - Database name.
   * @param {SqliteWebPersistenceEnvironment} args.environment - Browser-like environment.
   */
  constructor({databaseName, environment}) {
    this.databaseName = databaseName
    this.environment = environment
  }

  /**
   * Deletes the OPFS database file.
   * @returns {Promise<void>} - Resolves when deleted.
   */
  async delete() {
    const directory = await opfsDirectory(this.environment)

    try {
      await directory.removeEntry(sqliteWebPersistenceKey(this.databaseName))
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
  }

  /**
   * Loads the OPFS database file.
   * @returns {Promise<Uint8Array | undefined>} - Persisted bytes.
   */
  async load() {
    const directory = await opfsDirectory(this.environment)

    try {
      const fileHandle = await directory.getFileHandle(sqliteWebPersistenceKey(this.databaseName))
      const file = await fileHandle.getFile()
      const arrayBuffer = await file.arrayBuffer()

      return new Uint8Array(arrayBuffer)
    } catch (error) {
      if (isNotFoundError(error)) return undefined

      throw error
    }
  }

  /**
   * Checks whether the OPFS database file exists.
   * @returns {Promise<boolean>} - Whether content exists.
   */
  async exists() {
    try {
      return (await this.load()) !== undefined
    } catch {
      return false
    }
  }

  /**
   * Saves database bytes.
   * @param {Uint8Array} content - Database bytes.
   * @returns {Promise<void>} - Resolves when saved.
   */
  async save(content) {
    const directory = await opfsDirectory(this.environment)
    const fileHandle = await directory.getFileHandle(sqliteWebPersistenceKey(this.databaseName), {create: true})
    const writable = await fileHandle.createWritable()

    await writable.write(arrayBufferFromBytes(content))
    await writable.close()
  }
}

/** IndexedDB-backed SQL.js database blob persistence. */
class IndexedDbPersistence {
  /** @type {"indexeddb"} */
  name = "indexeddb"

  /**
   * Creates IndexedDB persistence.
   * @param {object} args - Arguments.
   * @param {string} args.databaseName - Database name.
   * @param {SqliteWebPersistenceEnvironment} args.environment - Browser-like environment.
   */
  constructor({databaseName, environment}) {
    this.databaseName = databaseName
    this.environment = environment
  }

  /**
   * Deletes the IndexedDB database entry.
   * @returns {Promise<void>} - Resolves when deleted.
   */
  async delete() {
    const database = await openIndexedDb(this.environment)

    await indexedDbRequest(database.transaction("databases", "readwrite").objectStore("databases").delete(sqliteWebPersistenceKey(this.databaseName)))
    database.close()
  }

  /**
   * Loads the IndexedDB database entry.
   * @returns {Promise<Uint8Array | undefined>} - Persisted bytes.
   */
  async load() {
    const database = await openIndexedDb(this.environment)
    const result = await indexedDbRequest(database.transaction("databases", "readonly").objectStore("databases").get(sqliteWebPersistenceKey(this.databaseName)))

    database.close()

    if (result === undefined) return undefined
    if (result instanceof Uint8Array) return result
    if (result instanceof ArrayBuffer) return new Uint8Array(result)

    throw new Error("SQLite web IndexedDB persistence returned unsupported content")
  }

  /**
   * Checks whether the IndexedDB database entry exists.
   * @returns {Promise<boolean>} - Whether content exists.
   */
  async exists() {
    try {
      const database = await openIndexedDb(this.environment)
      const result = await indexedDbRequest(database.transaction("databases", "readonly").objectStore("databases").get(sqliteWebPersistenceKey(this.databaseName)))

      database.close()

      return result !== undefined && result !== null
    } catch {
      return false
    }
  }

  /**
   * Saves database bytes.
   * @param {Uint8Array} content - Database bytes.
   * @returns {Promise<void>} - Resolves when saved.
   */
  async save(content) {
    const database = await openIndexedDb(this.environment)

    await indexedDbRequest(database.transaction("databases", "readwrite").objectStore("databases").put(content, sqliteWebPersistenceKey(this.databaseName)))
    database.close()
  }
}

/** LocalStorage-backed SQL.js database blob persistence for legacy migrations. */
class LocalStoragePersistence {

  /** @type {"localstorage"} */
  name = "localstorage"

  /**
   * Creates localStorage persistence.
   * @param {object} args - Arguments.
   * @param {string} args.databaseName - Database name.
   */
  constructor({databaseName}) {
    this.databaseName = databaseName
    /** @type {BetterLocalStorage | undefined} */
    this.storage = undefined
  }

  /**
   * Deletes the localStorage database entry.
   * @returns {Promise<void>} - Resolves when deleted.
   */
  async delete() {
    await this.localStorage().delete(sqliteWebPersistenceKey(this.databaseName))
  }

  /**
   * Loads the localStorage database entry.
   * @returns {Promise<Uint8Array | undefined>} - Persisted bytes.
   */
  async load() {
    const content = await this.localStorage().get(sqliteWebPersistenceKey(this.databaseName))

    if (content === null || content === undefined) return undefined
    if (content instanceof Uint8Array) return content
    if (content instanceof ArrayBuffer) return new Uint8Array(content)

    return /** @type {Uint8Array} */ (content)
  }

  /**
   * Saves database bytes.
   * @param {Uint8Array} content - Database bytes.
   * @returns {Promise<void>} - Resolves when saved.
   */
  async save(content) {
    await this.localStorage().set(sqliteWebPersistenceKey(this.databaseName), content)
  }

  /**
   * Checks whether the legacy localStorage database exists.
   * @returns {Promise<boolean>} - Whether content exists.
   */
  async exists() {
    try {
      const content = await this.localStorage().get(sqliteWebPersistenceKey(this.databaseName))

      return content !== undefined && content !== null
    } catch {
      return false
    }
  }

  /**
   * Returns the localStorage wrapper.
   * @returns {BetterLocalStorage} - Storage wrapper.
   */
  localStorage() {
    this.storage ||= new BetterLocalStorage()

    return this.storage
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
async function selectSupportedPersistence({environment, indexedDbPersistence, localStoragePersistence, opfsPersistence}) {
  if (await supportsOpfsPersistence(environment)) return opfsPersistence
  if (await supportsIndexedDbPersistence(environment)) return indexedDbPersistence

  return localStoragePersistence
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
async function migratePersistedDatabase({databaseName, destinationPersistence, environment, sourcePersistences}) {
  if (await destinationPersistence.load() !== undefined) return

  for (const sourcePersistence of sourcePersistences) {
    if (sourcePersistence === destinationPersistence) continue

    const databaseBytes = await loadPersistenceIfAvailable(sourcePersistence)
    if (databaseBytes === undefined) continue

    await destinationPersistence.save(databaseBytes)
    await deleteSqliteWebPersistences({databaseName, environment})
    await destinationPersistence.save(databaseBytes)
    return
  }
}

/**
 * Loads a persistence backend, ignoring unavailable backend errors.
 * @param {{load: () => Promise<Uint8Array | undefined>}} persistence - Persistence adapter.
 * @returns {Promise<Uint8Array | undefined>} - Persisted bytes, if available.
 */
async function loadPersistenceIfAvailable(persistence) {
  try {
    return await persistence.load()
  } catch {
    return undefined
  }
}

/**
 * Tests whether OPFS persistence is usable.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {Promise<boolean>} - Whether OPFS can be used.
 */
async function supportsOpfsPersistence(environment) {
  try {
    const directory = await opfsDirectory(environment)
    const fileHandle = await directory.getFileHandle(SUPPORT_CHECK_FILE, {create: true})
    const writable = await fileHandle.createWritable()

    await writable.write(arrayBufferFromBytes(SUPPORT_CHECK_BYTES))
    await writable.close()

    const file = await fileHandle.getFile()
    const readBack = new Uint8Array(await file.arrayBuffer())

    await directory.removeEntry(SUPPORT_CHECK_FILE)

    return sameBytes(readBack, SUPPORT_CHECK_BYTES)
  } catch {
    return false
  }
}

/**
 * Tests whether IndexedDB persistence is usable.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {Promise<boolean>} - Whether IndexedDB can be used.
 */
async function supportsIndexedDbPersistence(environment) {
  try {
    const database = await openIndexedDb(environment)
    const store = database.transaction("databases", "readwrite").objectStore("databases")

    await indexedDbRequest(store.put(SUPPORT_CHECK_BYTES, SUPPORT_CHECK_FILE))

    const readBack = await indexedDbRequest(store.get(SUPPORT_CHECK_FILE))

    await indexedDbRequest(store.delete(SUPPORT_CHECK_FILE))
    database.close()

    return readBack instanceof Uint8Array && sameBytes(readBack, SUPPORT_CHECK_BYTES)
  } catch {
    return false
  }
}

/**
 * Opens the SQLite web IndexedDB database.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {Promise<IDBDatabase>} - Open database.
 */
async function openIndexedDb(environment) {
  const indexedDb = indexedDbFromEnvironment(environment)

  if (!indexedDb || typeof indexedDb.open !== "function") throw new Error("IndexedDB is not available")

  const request = indexedDb.open("VelociousDatabaseDriversSqliteWeb", 1)
  request.onupgradeneeded = () => {
    const database = request.result

    if (!database.objectStoreNames.contains("databases")) database.createObjectStore("databases")
  }

  return await indexedDbRequest(request)
}

/**
 * Resolves an IndexedDB request.
 * @template T
 * @param {IDBRequest<T>} request - IndexedDB request.
 * @returns {Promise<T>} - Request result.
 */
function indexedDbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"))
  })
}

/**
 * Deletes a persistence backend, ignoring unavailable backend errors.
 * @param {{delete: () => Promise<void>}} persistence - Persistence adapter.
 * @returns {Promise<void>} - Resolves when deletion was attempted.
 */
async function deletePersistenceIfAvailable(persistence) {
  try {
    await persistence.delete()
  } catch {
    // Ignore unavailable backends so reset clears every backend the browser can access.
  }
}

/**
 * Gets OPFS root directory.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {Promise<FileSystemDirectoryHandle>} - OPFS root directory.
 */
async function opfsDirectory(environment) {
  const navigatorObject = navigatorFromEnvironment(environment)
  const storage = navigatorObject.storage

  if (!storage || typeof storage.getDirectory !== "function") throw new Error("OPFS is not available")

  return await storage.getDirectory()
}

/**
 * Gets navigator from environment.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {{storage?: {getDirectory?: () => Promise<FileSystemDirectoryHandle>}}} - Navigator-like object.
 */
function navigatorFromEnvironment(environment) {
  const candidate = environment.navigator

  if (!candidate || typeof candidate !== "object") return {}

  return /** @type {{storage?: {getDirectory?: () => Promise<FileSystemDirectoryHandle>}}} */ (candidate)
}

/**
 * Gets IndexedDB from environment.
 * @param {SqliteWebPersistenceEnvironment} environment - Browser-like environment.
 * @returns {{open?: (name: string, version?: number) => IDBOpenDBRequest} | undefined} - IndexedDB-like object.
 */
function indexedDbFromEnvironment(environment) {
  const candidate = environment.indexedDB

  if (!candidate || typeof candidate !== "object") return undefined

  return /** @type {{open?: (name: string, version?: number) => IDBOpenDBRequest}} */ (candidate)
}

/**
 * Converts bytes to a standalone ArrayBuffer for browser file writes.
 * @param {Uint8Array} bytes - Bytes to convert.
 * @returns {ArrayBuffer} - Standalone ArrayBuffer.
 */
function arrayBufferFromBytes(bytes) {
  const copy = new Uint8Array(bytes.byteLength)

  copy.set(bytes)

  return copy.buffer
}

/**
 * Checks whether an error is a file-not-found error.
 * @param {unknown} error - Error candidate.
 * @returns {boolean} - Whether the error is not found.
 */
function isNotFoundError(error) {
  return error instanceof Error && error.name === "NotFoundError"
}

/**
 * Compares two byte arrays.
 * @param {Uint8Array} left - Left bytes.
 * @param {Uint8Array} right - Right bytes.
 * @returns {boolean} - Whether bytes match.
 */
function sameBytes(left, right) {
  if (left.length !== right.length) return false

  return left.every((value, index) => value === right[index])
}
