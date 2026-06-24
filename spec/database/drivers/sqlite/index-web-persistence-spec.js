import {describe, expect, it} from "../../../../src/testing/test.js"
import {createSqliteWebPersistence, sqliteWebPersistenceKey} from "../../../../src/database/drivers/sqlite/web-persistence.js"

describe("database - drivers - sqlite web persistence", () => {
  it("chooses OPFS persistence when the browser storage directory is usable", async () => {
    const environment = buildEnvironment({opfs: true, indexedDb: true})

    const persistence = await createSqliteWebPersistence({databaseName: "app", environment})

    expect(persistence.name).toEqual("opfs")
  })

  it("falls back to IndexedDB persistence when OPFS is unavailable", async () => {
    const environment = buildEnvironment({opfs: false, indexedDb: true})

    const persistence = await createSqliteWebPersistence({databaseName: "app", environment})

    expect(persistence.name).toEqual("indexeddb")
  })

  it("falls back to localStorage persistence when IndexedDB fails the smoke test", async () => {
    const environment = buildEnvironment({opfs: false, indexedDb: true, indexedDbUsable: false})

    const persistence = await createSqliteWebPersistence({databaseName: "app", environment})

    expect(persistence.name).toEqual("localStorage")
  })

  it("falls back to localStorage persistence when OPFS and IndexedDB are unavailable", async () => {
    const environment = buildEnvironment({opfs: false, indexedDb: false})

    const persistence = await createSqliteWebPersistence({databaseName: "app", environment})

    expect(persistence.name).toEqual("localStorage")
  })

  it("stores SQL.js database bytes in the selected OPFS file", async () => {
    const environment = buildEnvironment({opfs: true, indexedDb: false})
    const persistence = await createSqliteWebPersistence({databaseName: "app", environment})
    const bytes = new Uint8Array([1, 2, 3])

    await persistence.save(bytes)

    expect(Array.from(await persistence.load() || [])).toEqual([1, 2, 3])
    await persistence.delete()
    expect(await persistence.load()).toEqual(undefined)
  })

  it("stores SQL.js database bytes in the selected IndexedDB entry", async () => {
    const environment = buildEnvironment({opfs: false, indexedDb: true})
    const persistence = await createSqliteWebPersistence({databaseName: "app", environment})
    const bytes = new Uint8Array([4, 5, 6])

    await persistence.save(bytes)

    expect(Array.from(await persistence.load() || [])).toEqual([4, 5, 6])
    await persistence.delete()
    expect(await persistence.load()).toEqual(undefined)
  })

  it("uses the existing localStorage key for compatibility", () => {
    expect(sqliteWebPersistenceKey("app")).toEqual("VelociousDatabaseDriversSqliteWeb---app")
  })
})

function buildEnvironment({opfs, indexedDb, indexedDbUsable = true}) {
  const directory = buildOpfsDirectory()

  return {
    indexedDB: indexedDb ? buildIndexedDb({usable: indexedDbUsable}) : undefined,
    navigator: {
      storage: {
        getDirectory: async () => {
          if (!opfs) throw new Error("OPFS unavailable")

          return directory
        }
      }
    }
  }
}

function buildOpfsDirectory() {
  const files = new Map()

  return {
    getFileHandle: async (name, options = {}) => {
      if (!files.has(name)) {
        if (!options.create) throw domException("NotFoundError")
        files.set(name, new Uint8Array())
      }

      return {
        createWritable: async () => ({
          close: async () => {},
          write: async (bytes) => {
            files.set(name, new Uint8Array(bytes))
          }
        }),
        getFile: async () => ({
          arrayBuffer: async () => files.get(name).buffer
        })
      }
    },
    removeEntry: async (name) => {
      if (!files.delete(name)) throw domException("NotFoundError")
    }
  }
}

function buildIndexedDb({usable}) {
  const stores = new Map()

  return {
    open: () => {
      const request = buildIndexedDbRequest()

      Promise.resolve().then(() => {
        if (!usable) {
          request.error = new Error("IndexedDB unavailable")
          request.onerror?.()
          return
        }

        request.result = buildIndexedDbDatabase(stores)
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })

      return request
    }
  }
}

function buildIndexedDbDatabase(stores) {
  return {
    close: () => {},
    createObjectStore: (name) => {
      if (!stores.has(name)) stores.set(name, new Map())
    },
    objectStoreNames: {
      contains: (name) => stores.has(name)
    },
    transaction: (name) => ({
      objectStore: () => buildIndexedDbObjectStore(stores.get(name))
    })
  }
}

function buildIndexedDbObjectStore(store) {
  return {
    delete: (key) => resolveIndexedDbRequest(() => {
      store.delete(key)
      return undefined
    }),
    get: (key) => resolveIndexedDbRequest(() => store.get(key)),
    put: (value, key) => resolveIndexedDbRequest(() => {
      store.set(key, value)
      return key
    })
  }
}

function buildIndexedDbRequest() {
  return {
    error: undefined,
    onerror: undefined,
    onsuccess: undefined,
    onupgradeneeded: undefined,
    result: undefined
  }
}

function resolveIndexedDbRequest(callback) {
  const request = buildIndexedDbRequest()

  Promise.resolve().then(() => {
    try {
      request.result = callback()
      request.onsuccess?.()
    } catch (error) {
      request.error = error
      request.onerror?.()
    }
  })

  return request
}

function domException(name) {
  const error = new Error(name)
  error.name = name

  return error
}
