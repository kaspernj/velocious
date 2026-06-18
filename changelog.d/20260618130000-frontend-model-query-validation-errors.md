## Fix

- Treat invalid frontend-model query descriptors, including unknown selected, filtered, joined, grouped, sorted, plucked, and Ransack attributes, as expected `frontend-model-validation` client errors instead of emitting framework errors.
