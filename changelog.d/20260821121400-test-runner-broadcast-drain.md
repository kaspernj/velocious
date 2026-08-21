Drain pending websocket broadcasts between tests so detached post-commit deliveries release their database connections before the next test starts.
