# TODO

- [ ] Add request-size and complexity limits for frontend-model APIs (`frontendApi` and command payloads): cap batched `requests` length, cap nested structure depth/keys for `where`/`joins`/`preload`/`group`/`sort`/`pluck`, and reject oversized payloads early to reduce DoS risk.
