# Expo And Metro Compatibility

Velocious keeps a minimal Expo app in `examples/expo` so Metro compatibility is verified with a real Expo export instead of only esbuild browser bundle checks.

## Local Check

Run the Expo compatibility build from the repository root:

```bash
npm run test:expo
```

The script builds Velocious first, installs the example app from its lockfile,
runs `expo export --platform all` from `examples/expo`, and then boots the
exported web app with System Testing. The exported app runs in-app compatibility
checks for configuration setup, frontend-model basics, event-hook imports, and
two physical frontend tenant SQLite replicas. The replica proof uses public
`Tenant.handle` APIs, real migrations/model operations, distinct physical
database names, and flush/close/reinitialize persistence; it does not inject a
fake connection.

The all-platform export is intentional: native bundles resolve
`velocious/build/src/database/drivers/sqlite/index` to `index.native.js` and the
fixture therefore opens `expo-sqlite` when launched on a device, while web
resolves it to `index.web.js` and executes the same fixture against SQL.js. The
command copies both SQL.js WASM runtime filenames into the exported web root.
It executes the web bundle locally but only builds the native bundles; an
Android/iOS runtime proof requires a hardware-accelerated emulator or device
lane.

## App Integration Rules

- Import Expo-shared Velocious modules from published `build/` paths.
- Import SQLite with the extensionless path `velocious/build/src/database/drivers/sqlite/index` in Expo apps so Metro can pick `index.web.js` for web and `index.native.js` for native.
- Add `expo-sqlite` to Expo apps that use the extensionless SQLite driver path, because native bundles resolve to Velocious's Expo SQLite driver.
- Ship the SQL.js WASM file under the filename requested by the resolved web
  bundle (`sql-wasm-browser.wasm` in the current Expo build, and
  `sql-wasm.wasm` for non-browser resolution) when hosting the exported app.
- Import portable background jobs from `velocious/build/src/background-jobs/platform-job.js` and list them as static class references in `backgroundJobs.jobClasses`. The Browser/Expo environment uses the [local SQLite dispatcher](local-background-jobs.md); it does not bundle Node TCP, worker, filesystem-registry, or child-process code.
- Keep `import.meta` and Node-only modules out of code that Metro imports. Use Node-only helpers for backend/server paths.
- Preserve Velocious class/function names in Metro minification when apps still rely on class names for runtime model/resource lookup.

```js
const minifierConfig = config.transformer.minifierConfig || {}

config.transformer.minifierConfig = {
  ...minifierConfig,
  keep_classnames: true,
  keep_fnames: true,
  mangle: {
    ...minifierConfig.mangle,
    keep_classnames: true,
    keep_fnames: true
  }
}
```

Generated frontend models should still declare stable `resourceConfig().modelName` values so production behavior does not depend solely on minifier settings.
