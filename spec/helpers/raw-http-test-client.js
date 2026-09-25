// @ts-check

import net from "node:net"
import timeout from "awaitery/build/timeout.js"

/**
 * Sends one raw HTTP request to the dummy server and resolves after close.
 * @param {Buffer | string} payload - Exact request bytes.
 * @returns {Promise<Buffer>} - Exact response bytes.
 */
export async function sendRawHttpRequest(payload) {
  const socket = net.createConnection({host: "127.0.0.1", port: 3006})
  /** @type {Buffer[]} */
  const chunks = []

  const responsePromise = new Promise((resolve, reject) => {
    socket.on("data", (chunk) => { chunks.push(chunk) })
    socket.on("end", () => resolve(Buffer.concat(chunks)))
    socket.on("error", reject)
  })

  socket.once("connect", () => { socket.write(payload) })

  try {
    return await timeout({timeout: 2000}, async () => await responsePromise)
  } finally {
    socket.destroy()
  }
}

/** @returns {Promise<import("node:net").Socket>} - Connected dummy-server socket. */
export async function connectRawHttpSocket() {
  const socket = net.createConnection({host: "127.0.0.1", port: 3006})

  await timeout({timeout: 2000}, async () => {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve)
      socket.once("error", reject)
    })
  })

  return socket
}

/**
 * Reads one Content-Length-framed response while preserving pipelined bytes.
 * @param {import("node:net").Socket} socket - Connected socket.
 * @param {Buffer} [initialBuffer] - Bytes already received after a previous response.
 * @returns {Promise<{body: Buffer, headers: string, remaining: Buffer, response: Buffer}>} - Parsed response.
 */
export async function readRawHttpResponse(socket, initialBuffer = Buffer.alloc(0)) {
  let buffer = initialBuffer

  return await timeout({timeout: 2000}, async () => {
    return await new Promise((resolve, reject) => {
      const consume = () => {
        const headerEndIndex = buffer.indexOf("\r\n\r\n")

        if (headerEndIndex === -1) return

        const headers = buffer.subarray(0, headerEndIndex).toString("latin1")
        const contentLengthMatch = headers.match(/Content-Length: (\d+)/iu)
        const contentLength = contentLengthMatch ? Number(contentLengthMatch[1]) : 0
        const responseEndIndex = headerEndIndex + 4 + contentLength

        if (buffer.length < responseEndIndex) return

        socket.off("data", onData)
        socket.off("error", reject)
        resolve({
          body: buffer.subarray(headerEndIndex + 4, responseEndIndex),
          headers,
          remaining: buffer.subarray(responseEndIndex),
          response: buffer.subarray(0, responseEndIndex)
        })
      }
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        consume()
      }

      socket.on("data", onData)
      socket.on("error", reject)
      consume()
    })
  })
}
