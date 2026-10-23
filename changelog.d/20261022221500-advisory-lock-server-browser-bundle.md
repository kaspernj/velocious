## Fixed

- The central lock-server advisory-lock tier no longer breaks Expo/browser bundles. Its
  Node-only `ws` transport was reachable from `Configuration` through a dynamic import, so
  Metro pulled `ws` into the bundle and failed with
  `Unable to resolve module stream ... ws/lib/stream.js`. Backend creation now goes through
  the Node environment handler (the same indirection the Beacon clients use), keeping the
  module off the browser path; a browser/Expo configuration that enables the tier fails
  loudly instead.
