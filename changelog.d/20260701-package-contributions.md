# Changelog

- Add support for external npm packages (engines) that contribute data models, frontend-model resources and migrations to a consuming app. List them in `Configuration({packages: [new VelociousPackage({name, url: import.meta.url})]})`; the framework loads each package's `src/models`, discovers its `src/resources`, runs its `src/database/migrations`, and generates its frontend models into the app's `src/frontend-models`. Model-name and cross-source migration-timestamp collisions fail loudly; apps that pass no `packages` are unaffected.
