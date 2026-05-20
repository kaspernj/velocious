Fix HTTP server startup so port binding errors reject startup instead of leaving a non-serving process alive. Preserve explicit port `0` so tests and callers can ask the OS for a random free port.
