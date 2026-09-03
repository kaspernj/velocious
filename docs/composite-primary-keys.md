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
const identity = {tenantId: "tenant-a", externalId: 42}
const item = await ExternalItem.find(identity)
```

Missing fields, extra fields, arrays, `null`, and non-scalar field values are rejected. Object property order is irrelevant; Velocious canonicalizes composite identities in the order of the `primaryKey` declaration for cache keys, attachment ownership, URLs, and lifecycle routing.

`record.id()` and `frontendRecord.primaryKeyValue()` return the identity object. Scalar-key models keep returning their existing scalar identity.

## CRUD behavior

Online `create`, `find`, `save`/`update`, and `destroy` use every identity component. Updates and destroys locate a persisted record by its original identity, so changing one or more key fields in an update is supported. After a successful key-changing update, the instance is reloaded under its new identity.

Frontend-model resources must expose every configured composite-key attribute. The generator rejects missing, duplicate, or empty composite-key definitions and emits the ordered array in `resourceConfig()`.

Authorization and per-record ability checks match complete identity tuples and batch candidate records within driver query limits. Attachments and WebSocket lifecycle listeners use an unambiguous ordered encoding internally while public lifecycle callbacks receive the identity object.

## Scalar-only boundaries

Offline frontend-model mutation queues, sync clients/publishers, and sync-envelope replay currently require a scalar primary key. Scalar foreign-key relationships, relationship preloaders, aggregate helpers, list ordering, auditing, and MSSQL distinct pagination also reject composite keys when invoked. These paths throw an operation-specific `does not support composite primary keys` error instead of coercing an object into an ambiguous string.

Use online frontend-model CRUD for composite resources until the relevant scalar-only feature gains a tuple-aware storage or query contract.
