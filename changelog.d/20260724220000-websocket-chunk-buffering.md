WebSocket sessions now buffer incomplete TCP frame chunks without repeatedly copying the accumulated payload, and reject single final data frames larger than 16 MiB before buffering their payload.
