# Changed

- Use `@velocious/testing` 0.0.9 as the sole declaration, selection, traversal,
  retry, console-capture, event, and result engine while Velocious supplies one
  framework-aware lifecycle attempt and projects results through its existing APIs.
- Make the Velocious testing facade share the package default context directly,
  preserve legacy awaited test events and expectations, support skip/todo/table
  declarations, and remove the package-to-legacy synchronization adapter.
