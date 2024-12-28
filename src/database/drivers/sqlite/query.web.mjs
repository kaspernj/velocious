export default async function query(connection, sql) {
  const rows = []

  for await (const entry of connection.exec(sql)) {
    rows.push(entry)
  }

  return rows
}
