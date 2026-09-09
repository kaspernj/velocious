# Git dependency installation

Velocious commits the generated `build/` directory so consumers can install an
exact Git revision without running package lifecycle scripts. This supports
restricted CI environments where dependency scripts and Git SSH credentials are
unavailable.

Use an immutable GitHub commit archive when the install must remain
credential-free:

```json
{
  "dependencies": {
    "velocious": "https://github.com/kaspernj/velocious/archive/<commit-sha>.tar.gz"
  }
}
```

The archive contains the same `build/` entry points declared by `package.json`.
Registry packages continue to run `prepack` before publication.

Maintainers must run `npm run build` and commit every resulting `build/` change
alongside source changes. Generated files must never be edited manually.
