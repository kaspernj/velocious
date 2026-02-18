# Routing Hooks and Frontend-Model Autoroutes

## Goal
Projects should not need to manually define every frontend-model command endpoint route.

## Supported approach
- Velocious route hooks can hijack unresolved or pre-resolve routes.
- Frontend-model autoroute resolution can use configured backend resources to map command requests automatically.

## Practical outcome
- Command routes such as frontend index/find/create/update/destroy should resolve through Velocious internals when resources are declared.
- App projects should avoid repetitive local routing boilerplate for frontend-model commands.

## Testing
- Keep autoroute behavior covered by route resolver specs.
- Prefer request-level/browser-level tests for route resolution behavior.
