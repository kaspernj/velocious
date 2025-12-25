## Purpose
This repo uses an automated “definition of done” for changes. Before declaring work complete, run the appropriate verification commands and fix any failures.

## Verification commands

### Quick check (fast)
Run this frequently while iterating:

1) Lint
   `npm run lint`

2) Typecheck
   `npm run typecheck`

### Normal check (full validation, slower)
Before you say the work is done, run:

1) `npm run lint`
2) `npm run typecheck`
3) `npm test`

If any command fails:
- Read the error output, fix the underlying issue, and re-run the same command.
- Repeat until the command succeeds (or clearly explain why it cannot be made to pass).

## When to run which check
- **Tiny change (docs/comments/non-functional formatting):** you may skip checks.
- **Most code changes:** run **Quick check** at least once while iterating.
- **Before final completion / ready for review:** run **Normal check**.

## Making tests faster while iterating (focus mode)

When iterating on tests, you may temporarily focus a subset of tests to speed up feedback.
This repo supports a `focus` argument on `describe` / `it` blocks:

### Focus a `describe`
```js
describe("something", {focus: true}, () => {
  // ...
})
```

### Focus a `it`
```js
describe("something", () => {
  it("sample", { focus: true }, () => {
    // ...
  })
})
```
