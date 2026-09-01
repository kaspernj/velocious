/**
 * Computes SHA-256 without importing Node-only crypto modules, keeping this
 * module safe for Expo/browser bundles. Implementation is a straightforward
 * pure-JavaScript SHA-256 derived from FIPS 180-4, using only 32-bit unsigned
 * integer arithmetic.
 * @param {string} message - UTF-8 message.
 * @returns {string} - Hex digest.
 */
export default function sha256Hex(message) {
  const bytes = utf8Bytes(message)
  const padded = [...bytes]
  const bitLength = bytes.length * 8
  const hash = [...SHA256_INITIAL_HASH]
  /** @type {number[]} */
  const words = new Array(64)

  padded.push(0x80)
  while (padded.length % 64 !== 56) padded.push(0)

  const highLength = Math.floor(bitLength / 0x100000000)
  const lowLength = bitLength >>> 0

  for (const value of [highLength, lowLength]) {
    padded.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
  }

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const index = offset + (i * 4)

      words[i] = (((padded[index] || 0) << 24) | ((padded[index + 1] || 0) << 16) | ((padded[index + 2] || 0) << 8) | (padded[index + 3] || 0)) >>> 0
    }

    for (let i = 16; i < 64; i++) {
      const s0 = rotateRight(words[i - 15], 7) ^ rotateRight(words[i - 15], 18) ^ (words[i - 15] >>> 3)
      const s1 = rotateRight(words[i - 2], 17) ^ rotateRight(words[i - 2], 19) ^ (words[i - 2] >>> 10)

      words[i] = add32(words[i - 16], s0, words[i - 7], s1)
    }

    let [a, b, c, d, e, f, g, h] = hash

    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const ch = (e & f) ^ ((~e) & g)
      const temp1 = add32(h, s1, ch, SHA256_K[i], words[i])
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = add32(s0, maj)

      h = g
      g = f
      f = e
      e = add32(d, temp1)
      d = c
      c = b
      b = a
      a = add32(temp1, temp2)
    }

    hash[0] = add32(hash[0], a)
    hash[1] = add32(hash[1], b)
    hash[2] = add32(hash[2], c)
    hash[3] = add32(hash[3], d)
    hash[4] = add32(hash[4], e)
    hash[5] = add32(hash[5], f)
    hash[6] = add32(hash[6], g)
    hash[7] = add32(hash[7], h)
  }

  return hash.map((value) => value.toString(16).padStart(8, "0")).join("")
}

const SHA256_INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]

/**
 * Converts a string to UTF-8 bytes.
 * @param {string} value - String value.
 * @returns {number[]} - UTF-8 bytes.
 */
function utf8Bytes(value) {
  /** @type {number[]} */
  const bytes = []

  for (const character of value) {
    const codePoint = /** @type {number} */ (character.codePointAt(0))

    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >>> 12), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
    } else {
      bytes.push(0xf0 | (codePoint >>> 18), 0x80 | ((codePoint >>> 12) & 0x3f), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
    }
  }

  return bytes
}

/**
 * Adds unsigned 32-bit integers.
 * @param {...number} values - Values to add.
 * @returns {number} - Unsigned 32-bit result.
 */
function add32(...values) {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0)
}

/**
 * Rotates a 32-bit integer right.
 * @param {number} value - Value to rotate.
 * @param {number} bits - Bit count.
 * @returns {number} - Rotated value.
 */
function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits))
}
