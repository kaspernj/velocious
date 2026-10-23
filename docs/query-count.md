# Counting rows and column values — `count(column)`

`count()` counts matching rows. Passing a column counts non-null values of that
column instead, and combining it with `.distinct()` counts distinct non-null
values — the same shape as Rails' `count(:column)` and
`distinct.count(:column)`.

```js
await Ticket.count()                        // COUNT(*)
await Ticket.where({eventId}).count()       // COUNT(*) with the condition
await Ticket.where({eventId}).count("pytId")        // COUNT(tickets.pyt_id)
await Ticket.where({eventId}).distinct().count("pytId") // COUNT(DISTINCT tickets.pyt_id)
```

## Column names

Both generated attribute names and physical column names are accepted
(`"pytId"` and `"pyt_id"`). The name is resolved against the model's attribute
map and quoted; an unknown column throws instead of reaching SQL.

## Semantics

- `COUNT(column)` follows SQL semantics and ignores `NULL` values.
- `.distinct()` applies to the column when one is given, and to the primary key
  when it is not.
- Filters, joins, and groups apply as usual. A grouped count sums each group's
  count, matching the existing `count()` behavior.
- `limit` / `offset` restrict the rows considered: a paginated column count
  counts the column values in the paginated subquery.

This API is available on database-model queries (`ModelClassQuery`, static
`Model.count(column)`, and tenant model scopes). Frontend-model `count()` keeps
counting matching records; it does not take a column argument.

For per-row association counts, see [with-count.md](with-count.md).
