## Changed

- Scheduled background jobs: the `every` first-run delay option is now `firstIn` only. The Sidekiq-style `first_in` snake_case alias has been removed so the option matches Velocious' camelCase config convention. The scheduled-job config types are exact, so an unknown key — including the now-removed `first_in` — is a TypeScript error at the call site rather than a silently-ignored option.
