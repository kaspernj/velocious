# Fixed

- Publish committed ordinary and magnitude counter-cache parent changes through
  the existing frontend-model realtime update path, while suppressing rolled-back
  attempts, preserving operation, tenant, resource, and authorization routing,
  and carrying the previous identity when a counter column participates in it.
