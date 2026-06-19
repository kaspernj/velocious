## Fix

- Treat invalid frontend-model query descriptors, including unknown selected, filtered, joined, grouped, sorted, plucked, and Ransack attributes, as expected `frontend-model-query-error` client errors instead of emitting framework errors.
