// @ts-check

/**
 * Builds a single masked client-to-server WebSocket frame, matching
 * the wire shape produced by browser clients.
 * @param {{fin?: boolean, opcode?: number, payload: Buffer | string}} args - Frame options.
 * @returns {Buffer} - Encoded masked WebSocket frame.
 */
export function buildMaskedClientFrame({fin = true, opcode = 0x1, payload}) {
  const payloadBuffer = typeof payload === "string" ? Buffer.from(payload, "utf-8") : payload
  const mask = Buffer.from([0x01, 0x02, 0x03, 0x04])
  const maskedPayload = Buffer.alloc(payloadBuffer.length)

  for (let i = 0; i < payloadBuffer.length; i++) {
    maskedPayload[i] = payloadBuffer[i] ^ mask[i % 4]
  }

  const firstByte = (fin ? 0x80 : 0x00) | (opcode & 0x0F)
  /** @type {Buffer} */
  let header

  if (payloadBuffer.length < 126) {
    header = Buffer.from([firstByte, 0x80 | payloadBuffer.length])
  } else if (payloadBuffer.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = firstByte
    header[1] = 0x80 | 126
    header.writeUInt16BE(payloadBuffer.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = firstByte
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(payloadBuffer.length), 2)
  }

  return Buffer.concat([header, mask, maskedPayload])
}

/**
 * Builds a masked final client text frame containing JSON text.
 * @param {string} payload - Raw UTF-8 JSON payload.
 * @returns {Buffer} - Encoded masked text frame.
 */
export function buildMaskedClientTextFrame(payload) {
  return buildMaskedClientFrame({payload})
}

/**
 * Decodes a small unmasked server close frame.
 * @param {Buffer} frame - Server-to-client close frame.
 * @returns {{code: number | undefined, reason: string}} - Close status and UTF-8 reason.
 */
export function decodeServerCloseFrame(frame) {
  if (frame[0] !== 0x88) throw new Error("Expected a final WebSocket close frame")

  const payloadLength = frame[1] & 0x7F

  if (payloadLength === 0) return {code: undefined, reason: ""}
  if (payloadLength < 2) throw new Error("Expected close payload to contain a status code")

  return {
    code: frame.readUInt16BE(2),
    reason: frame.subarray(4, 2 + payloadLength).toString("utf-8")
  }
}
