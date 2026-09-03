Frontend-model attachment metadata can now be declared once on backend models
with `hasOneAttachment(name, {sync})` or `hasManyAttachments(name, {sync})`.
Velocious validates fetch, retention, and offline-requirement policy, derives
resource and generated frontend-model attachment config automatically, and
keeps backend storage drivers out of client-visible metadata. Backend records
and frontend model classes now share the `attachmentDefinitions()` contract so
frontend/local resource wrappers can derive the same configuration.
