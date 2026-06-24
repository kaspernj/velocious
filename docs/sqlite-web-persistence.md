# SQLite web persistence

Velocious's web SQLite driver uses `sql.js` for the in-browser SQLite runtime. The driver automatically chooses a durable browser persistence backend; application code does not need to configure a persistence strategy.

Selection order:

1. Use **OPFS** (`navigator.storage.getDirectory`) when a small write/read/delete smoke test succeeds.
2. Otherwise use **IndexedDB** when it passes its smoke test.
3. If existing database bytes are found in another backend, migrate them into the selected backend and clear the old copy.
4. If neither OPFS nor IndexedDB is available, use the legacy localStorage-style backend as a compatibility fallback.

`reset` clears the database name from every available backend before selecting the backend for the fresh database, so stale bytes are not resurrected when browser capabilities change later.

## Backends

### OPFS

OPFS is preferred because it stores the SQLite database bytes in the browser origin's private filesystem instead of putting the exported database into localStorage-style storage. The current implementation still runs `sql.js` in memory and persists exported database bytes after writes; it is a better storage target than localStorage, but it is not yet a page-level SQLite VFS.

Future work can replace the export-on-write path with a true SQLite WASM OPFS VFS without changing application configuration.

### IndexedDB

IndexedDB is used for browsers where OPFS is unavailable or fails the smoke test. It stores the exported database bytes under the same stable Velocious database key in an IndexedDB object store. Like OPFS in this slice, this keeps SQLite semantics and avoids localStorage, but it is still SQL.js export persistence rather than a page-level VFS.

### Legacy localStorage-style storage

The previous web driver stored the whole exported SQLite database blob under the legacy `VelociousDatabaseDriversSqliteWeb---<name>` key. When legacy bytes are available and OPFS or IndexedDB works, Velocious migrates the bytes into the selected backend and clears the legacy copy instead of continuing to use the worse backend.

If no better backend is available, Velocious keeps using the legacy backend so browsers without OPFS/IndexedDB support can still open web SQLite databases.

## Database configuration

No new configuration is required:

```js
import SqliteDriver from "velocious/build/src/database/drivers/sqlite/index.web.js"

export default new Configuration({
  database: {
    development: {
      default: {
        driver: SqliteDriver,
        type: "sqlite",
        name: "app-db"
      }
    }
  }
})
```

`locateFile` still controls where `sql.js` loads its WASM files from; persistence backend selection is independent of WASM asset resolution.
