## Fixed

- Generated frontend-model custom command methods now accept variadic arguments.
- Added `FrontendModelBase.normalizeCustomCommandPayloadArguments(...)` to convert positional arguments into the command payload shape expected by existing custom-command transport (`arg1`, `arg2`, ...).
