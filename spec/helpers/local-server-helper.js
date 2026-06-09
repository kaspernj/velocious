// @ts-check

/**
 * @param {import("node:net").Server} server - Server to bind on localhost.
 * @returns {Promise<number>} Bound TCP port.
 */
export async function listenOnLocalhost(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve(undefined))
  })

  const address = server.address()

  if (!address || typeof address !== "object") {
    throw new Error("Server did not expose a TCP port.")
  }

  return address.port
}
