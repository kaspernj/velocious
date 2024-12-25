export default async function query(connection, sql) {
  const rows = []

  for await (const entry of connection.getEachAsync(sql)) {
    rows.push(entry)
  }

  return rows
}
