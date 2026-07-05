# Velocious packages (engines)

External npm packages can contribute **data models, frontend-model resources and migrations** to a consuming app. A package ships its model / resource / migration once; the app registers the package and Velocious loads its models, discovers its resources, runs its migrations, and generates its frontend models into the app — so consumers don't hand-write any of it.

## Authoring a package

Structure the package like a mini backend and export a descriptor from its root:

```
your-package/
  velocious-package.js
  src/
    models/foo.js
    model-bases/foo.js
    resources/foo-resource.js          # a *-resource.js with a static ModelClass
    database/migrations/20260101000000-create-foos.js
```

```js
// velocious-package.js
import VelociousPackage from "velocious/build/src/packages/velocious-package.js"

export default new VelociousPackage({name: "your-package", url: import.meta.url})
```

`url: import.meta.url` lets the framework derive the package root (the directory containing this file) and, from it, `src/models`, `src/resources` and `src/database/migrations`. Override any of them with `modelsPath` / `resourcesPath` / `migrationsPath` if your layout differs. (A dependency-free package may instead export a plain `{name, path}` descriptor — the app wraps it via `VelociousPackage.from(...)`.)

## Registering packages in an app

```js
import yourPackage from "your-package/velocious-package.js"

new Configuration({
  packages: [yourPackage],
  // ...the app's own configuration
})
```

That is all the app needs. On boot Velocious:

- **Models** — loads the package's `src/models` right after the app's own `initializeModels` hook. A package model whose name collides with an already-registered (different) model throws a clear error.
- **Resources** — auto-discovers the package's `src/resources/*-resource.js` (the same discovery used for the app's own resources), so package models get frontend-model HTTP endpoints, authorization, and realtime websocket broadcasting for free.
- **Migrations** — `db:migrate` / `db:tenants:migrate` / `rollback` run the app's migrations **and** every package's, interleaved by their 14-digit timestamp. Timestamps must be unique across the app and all packages — a cross-source collision throws (the `schema_migrations` ledger keys on the timestamp).
- **Frontend models** — `velocious generate:frontend-models` writes each package's frontend model into the app's `src/frontend-models` and registers it via the app's shared `setup.js` — identical to the app's own models. (Import each model by its file path; no barrel `index.js` is generated.)

Apps that pass no `packages` behave exactly as before.
