## HTTP compression protocol edges

- The framework now owns the `Vary: Accept-Encoding` header: it is emitted
  identically for every selected representation (transformed, identity, 406,
  file) whenever compression is enabled, so intermediate caches key on the
  request header correctly. It is never added when compression is disabled,
  the response is truly bodyless, or the application supplied its own
  `Content-Encoding`.
- Repeated `Accept-Encoding` request header fields are now combined in wire
  order (RFC 9110 §5.3) before negotiation; all other repeated headers keep
  last-wins behavior.
- `sendFile` responses whose client forbids identity now answer with an empty
  `406 Not Acceptable` instead of streaming the file. The file is never opened;
  `onFinished` still settles once as `"completed"`.
- Q-value boundary forms (`0.`, `1.`, `0.000`, `1.000`) are now accepted as
  valid per the RFC 9110 grammar.
