# Fixed

- Preserve generated frontend models as real named and default class exports
  while retaining their schema-specific lifecycle event types.
- Preserve inferred destroy-event identity types on hand-written subclasses and
  reject collection commands that collide with the generated `onDestroy` hook.
