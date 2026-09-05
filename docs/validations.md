# Validations

Declare model validations with `validates(...)` on the record class. Failed
validations raise a `ValidationError` on `save()` / `create()` with translated
per-attribute messages from the `velocious.errors.messages.*` layer.

```js
import Record from "velocious/build/src/database/record/index.js"

class Task extends Record {
}

Task.validates("name", {presence: true, uniqueness: true})

export default Task
```

Available validators: `presence`, `uniqueness` (optionally `scope`d), `length`,
and `format` (with `allowBlank`).

## Presence semantics for non-string values

`{presence: true}` treats only absent values as blank:

- `null` and `undefined` are blank.
- Strings are trimmed first; an empty or whitespace-only string is blank.

Every non-string value counts as present without any string coercion. This
includes `Date` instances, numbers (including `0`), and booleans (including
`false`) — a stored `0` or `false` is a legitimate present value and never
fails presence validation.
