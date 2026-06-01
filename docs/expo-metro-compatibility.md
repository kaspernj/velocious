# Expo And Metro Compatibility

Velocious keeps a minimal Expo app in `examples/expo` so Metro compatibility is verified with a real Expo export instead of only esbuild browser bundle checks.

## Local Check

Run the Expo compatibility build from the repository root:

```bash
npm run test:expo
```

The script builds Velocious first, installs the example app from its lockfile, and runs `expo export --platform all` from `examples/expo`. The all-platform export is intentional: native bundles resolve `velocious/build/src/database/drivers/sqlite/index` to `index.native.js`, while web resolves it to `index.web.js`.

## App Integration Rules

- Import Expo-shared Velocious modules from published `build/` paths.
- Import SQLite with the extensionless path `velocious/build/src/database/drivers/sqlite/index` in Expo apps so Metro can pick `index.web.js` for web and `index.native.js` for native.
- Add `expo-sqlite` to Expo apps that use the extensionless SQLite driver path, because native bundles resolve to Velocious's Expo SQLite driver.
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
