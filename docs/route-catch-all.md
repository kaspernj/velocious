# Route Catch-All

## Goal
Applications that need their own 404 response (for example a JSON error envelope for an API service) should declare it in the routes file with the standard routes DSL instead of hand-wiring a `routeResolverHooks` fallback.

## Usage

```js
// src/config/routes.js
import Routes from "velocious/build/src/routes/index.js"

const routes = new Routes()

routes.draw((route) => {
  route.namespace("api", (route) => {
    route.post("actionName")
  })

  // Unmatched requests resolve to src/routes/errors/controller.js#notFound
  route.catchAll({action: "notFound", controller: "errors"})
})

export default routes
```

`route.catchAll(options)`:

- `controller` (default `"_root"`) — the controller name unmatched requests resolve to, looked up at `src/routes/<controller>/controller.js` like any other controller.
- `action` (default `"notFound"`) — the action name, normalized through the standard action normalizer.
- Unknown options raise immediately.
- Declaring more than one catch-all raises `Only one catchAll route can be declared`.

## Resolver behavior

The catch-all is not a path matcher: the resolver applies it only after no other route in the tree matched the request path. When applied it:

- resolves the controller/action through the standard controller lookup and instantiation,
- skips tenant, ability, and database-connection resolution — the same guarantees the built-in not-found path has, so a 404 never requires a database or resolver,
- keeps request params (including query parameters) available to the action.

When no catch-all is declared, the built-in `errors#notFound` plain-text response is unchanged.

## Relationship to route resolver hooks

`routeResolverHooks` remain the escape hatch for libraries that hijack routes before normal resolution (see `docs/routing-hooks-and-autoroutes.md` and the README section on route resolver hooks). For the plain "serve my own 404" case, prefer `route.catchAll(...)` in the routes file: it keeps all routing in the route table where the framework owns it.
