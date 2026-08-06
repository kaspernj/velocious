# Recover pooled child model initialization atomically

Make the shared model-initialization phase commit its ready state only after every
step succeeds. A warm pooled background-job child that reports a bootstrap error
now performs a complete model initialization before admitting later jobs, instead
of skipping models and exposing partially initialized record classes. Concurrent
callers still share one bootstrap promise, original errors still propagate, and
pooled concurrency, connection scoping, and terminal acknowledgements are
unchanged.
