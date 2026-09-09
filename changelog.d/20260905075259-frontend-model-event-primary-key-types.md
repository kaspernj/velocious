# Fixed

- Preserve each generated frontend model's concrete primary-key and lifecycle
  event types so scalar consumers no longer receive an unrelated composite-key
  union while composite models keep their exact keyed identity objects.
