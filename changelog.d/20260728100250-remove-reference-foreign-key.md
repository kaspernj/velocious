* Add `removeForeignKey(...)` for removing introspected foreign-key constraints without dropping their columns or indexes.
* Make `removeReference(...)` await removal of matching foreign keys, generated single-column indexes (including unique indexes), and the reference column across database drivers.
