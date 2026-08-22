Fix request tests that open a transaction inside `beforeEach` to serialize shared parent and in-process HTTP database operations before the hook dispatches its request.
