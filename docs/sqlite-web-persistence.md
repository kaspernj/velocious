# SQLite web persistence

Velocious's web SQLite driver uses `sql.js` for the in-browser SQLite runtime. The driver now chooses the best persistence backend it can detect automatically; application code does not need to configure a persistence strategy.

Selection order for new web databases:

1. **OPFS** (`navigator.storage.getDirectory`) when a small write/read/delete smoke test succeeds.
2. **IndexedDB** when OPFS is unavailable and IndexedDB is present.
3. **localStorage** as the compatibility fallback.

Existing localStorage databases keep using the legacy localStorage key so upgrades do not silently orphan an already persisted browser database. New databases on modern browsers should land on OPFS first.

## Backends

### OPFS

OPFS is preferred because it stores the SQLite database bytes in the browser origin's private filesystem instead of putting the exported database into localStorage. The current implementation still runs `sql.js` in memory and persists exported database bytes after writes; it is a better storage target than localStorage, but it is not yet a page-level SQLite VFS.

Future work can replace the export-on-write path with a true SQLite WASM OPFS VFS without changing application configuration.

### IndexedDB

IndexedDB is the fallback for browsers where OPFS is unavailable or fails the smoke test. It stores the exported database bytes under the same stable Velocious database key in an IndexedDB object store. Like OPFS in this slice, this keeps SQLite semantics and avoids localStorage, but it is still SQL.js export persistence rather than a page-level VFS.

### localStorage

localStorage remains available for compatibility, tests, demos, older browsers, and existing databases already persisted with the previous driver. It stores the whole exported SQLite database blob under the legacy `VelociousDatabaseDriversSqliteWeb---<name>` key and should not be treated as the preferred storage for large offline/sync-heavy web apps.

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
