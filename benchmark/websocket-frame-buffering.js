import {performance} from "node:perf_hooks"

import Configuration from "../src/configuration.js"
import EventEmitter from "../src/utils/event-emitter.js"
import NodeEnvironmentHandler from "../src/environment-handlers/node.js"
import WebsocketSession from "../src/http-server/client/websocket-session.js"

const mask = Buffer.from([0x01, 0x02, 0x03, 0x04])
const tcpChunkSizes = [4096, 8192, 16384, 12288]

/**
 * Builds one masked final text frame.
 * @param {number} payloadBytes - Approximate JSON payload size.
 * @returns {Buffer} - Client websocket frame.
 */
function buildFrame(payloadBytes) {
  const payload = Buffer.from(JSON.stringify({type: "metadata", data: {contents: "x".repeat(payloadBytes)}}))
  const header = Buffer.alloc(14)
  const maskedPayload = Buffer.allocUnsafe(payload.length)

  header[0] = 0x81
  header[1] = 0x80 | 127
  header.writeBigUInt64BE(BigInt(payload.length), 2)
  mask.copy(header, 10)

  for (let index = 0; index < payload.length; index += 1) {
    maskedPayload[index] = payload[index] ^ mask[index % mask.length]
  }

  return Buffer.concat([header, maskedPayload])
}

/**
 * Measures one TCP-fragmented frame.
 * @param {number} payloadBytes - Approximate frame payload size.
 * @returns {Promise<{elapsedMs: number, frameBytes: number, oldConcatBytes: number, parserCopyBytes: number}>}
 */
async function measure(payloadBytes) {
  const configuration = new Configuration({
    autoload: false,
    database: {},
    directory: process.cwd(),
    environmentHandler: new NodeEnvironmentHandler()
  })
  let dispatchedMessages = 0
  const session = new WebsocketSession({
    client: {events: new EventEmitter(), remoteAddress: "127.0.0.1"},
    configuration,
    messageHandler: {
      onMessage: () => { dispatchedMessages += 1 }
    }
  })
  const frame = buildFrame(payloadBytes)
  let bufferedBytes = 0
  let oldConcatBytes = 0
  let offset = 0
  let chunkIndex = 0
  const startedAt = performance.now()

  while (offset < frame.length) {
    const chunkSize = tcpChunkSizes[chunkIndex % tcpChunkSizes.length]
    const end = Math.min(offset + chunkSize, frame.length)
    const chunk = frame.subarray(offset, end)

    oldConcatBytes += bufferedBytes + chunk.length
    bufferedBytes += chunk.length
    session.onData(chunk)
    offset = end
    chunkIndex += 1
  }

  await session._messageChain

  if (dispatchedMessages !== 1) throw new Error(`Expected one dispatched message, got ${dispatchedMessages}`)
  if (session._bufferedFrameCopyBytes > frame.length) {
    throw new Error(`Parser copied ${session._bufferedFrameCopyBytes} bytes for a ${frame.length}-byte frame`)
  }

  session.destroy()

  return {
    elapsedMs: performance.now() - startedAt,
    frameBytes: frame.length,
    oldConcatBytes,
    parserCopyBytes: session._bufferedFrameCopyBytes
  }
}

const measurements = []

for (const payloadBytes of [1024 * 1024, 2 * 1024 * 1024, 4 * 1024 * 1024, 8 * 1024 * 1024]) {
  measurements.push(await measure(payloadBytes))
}

console.log("frame\tparser copies\tcopy ratio\told concat equivalent\telapsed")
for (const measurement of measurements) {
  console.log([
    `${(measurement.frameBytes / 1024 / 1024).toFixed(2)} MiB`,
    `${(measurement.parserCopyBytes / 1024 / 1024).toFixed(2)} MiB`,
    `${(measurement.parserCopyBytes / measurement.frameBytes).toFixed(2)}x`,
    `${(measurement.oldConcatBytes / 1024 / 1024).toFixed(2)} MiB`,
    `${measurement.elapsedMs.toFixed(2)} ms`
  ].join("\t"))
}

for (let index = 1; index < measurements.length; index += 1) {
  const prior = measurements[index - 1]
  const current = measurements[index]
  const frameGrowth = current.frameBytes / prior.frameBytes
  const copyGrowth = current.parserCopyBytes / prior.parserCopyBytes

  if (copyGrowth > frameGrowth * 1.01) {
    throw new Error(`Copy growth ${copyGrowth.toFixed(2)}x exceeded frame growth ${frameGrowth.toFixed(2)}x`)
  }
}
