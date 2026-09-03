# Composite primary keys

Velocious records and frontend-model resources can identify a row with more than one attribute. Declare the ordered key on the backend record and expose the same attributes through the resource:

```js
class ExternalItem extends Record {}

ExternalItem.setPrimaryKey(["tenant_id", "external_id"])

class ExternalItemResource extends FrontendModelBaseResource {
  static ModelClass = ExternalItem
  static attributes = ["tenantId", "externalId", "name"]
  static primaryKey = ["tenantId", "externalId"]
}
```

The database record declaration uses database column names. The resource and generated frontend model use exposed frontend attribute names.

## Identity values

A composite identity is a plain object containing every configured field exactly once. Values must be strings or numbers:

```js
const identity = {tenant_id: "tenant-a", external_id: 42}
const item = await ExternalItem.find(identity)
```

Missing fields, extra fields, arrays, `null`, and non-scalar field values are rejected. Object property order is irrelevant; Velocious canonicalizes composite identities in the order of the `primaryKey` declaration for cache keys, attachment ownership, URLs, and lifecycle routing.

`record.id()` and `frontendRecord.primaryKeyValue()` return the identity object. Scalar-key models keep returning their existing scalar identity.

## CRUD behavior

Online `create`, `find`, `save`/`update`, and `destroy` use every identity component. Updates and destroys locate a persisted record by its original identity, so changing one or more key fields in an update is supported. After a successful key-changing update, the instance is reloaded under its new identity.

Frontend-model resources must expose every configured composite-key attribute. The generator rejects missing, duplicate, or empty composite-key definitions and emits the ordered array in `resourceConfig()`.

Authorization and per-record ability checks match complete identity tuples and batch candidate records within driver query limits. Attachment handles use canonical backing-record ownership returned by the server, including unprojected lifecycle records, while retaining the originating resource name for authorization; resource aliases can therefore expose a composite identity even when attachment storage uses a different backing key. WebSocket lifecycle publishers fan out through every resource backed by a record class; each resource receives its own configured identity, and key-changing updates include the previous identity so remote instance listeners move to the new tuple before later events arrive. Create/update records are reloaded and serialized through the subscribed resource, so an alias never receives backing-model attributes it does not expose.

## Scalar-only boundaries

Offline frontend-model mutation queues, sync clients/publishers, and sync-envelope replay currently require a scalar primary key. Scalar foreign-key relationships, relationship preloaders, aggregate helpers, list ordering, auditing, and MSSQL distinct pagination also reject composite keys when invoked. These paths throw an operation-specific `does not support composite primary keys` error instead of coercing an object into an ambiguous string.

Use online frontend-model CRUD for composite resources until the relevant scalar-only feature gains a tuple-aware storage or query contract.
