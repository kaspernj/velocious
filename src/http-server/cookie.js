// @ts-check

import crypto from "crypto"

export default class Cookie {
  /**
   * @typedef {object} CookieOptions
   * @property {string} [domain] - Domain.
   * @property {Date} [expires] - Expires date.
   * @property {boolean} [httpOnly] - HttpOnly flag.
   * @property {number} [maxAge] - Max-Age in seconds.
   * @property {string} [path] - Path.
   * @property {boolean} [secure] - Secure flag.
   * @property {"Lax" | "Strict" | "None"} [sameSite] - SameSite value.
   */

  /**
   * @param {object} args - Options object.
   * @param {string} args.name - Cookie name.
   * @param {string | undefined | null} args.value - Cookie value.
   * @param {string | undefined | null} [args.rawValue] - Raw cookie value.
   * @param {CookieOptions} [args.options] - Cookie options.
   * @param {boolean} [args.encrypted] - Whether cookie is encrypted.
   * @param {Error | undefined} [args.error] - Decryption error.
   */
  constructor({name, value, rawValue, options, encrypted = false, error}) {
    this._name = name
    this._value = value ?? ""
    this._rawValue = rawValue ?? this._value
    this._options = options || {}
    this._encrypted = encrypted
    this._error = error
  }

  /** @returns {string} - Cookie name. */
  name() { return this._name }

  /** @returns {string} - Cookie value (decrypted when available). */
  value() { return String(this._value ?? "") }

  /** @returns {string} - Raw cookie value. */
  rawValue() { return String(this._rawValue ?? "") }

  /** @returns {boolean} - Whether cookie is encrypted. */
  isEncrypted() { return Boolean(this._encrypted) }

  /** @returns {Error | undefined} - Decryption error. */
  error() { return this._error }

  /** @returns {string} - Set-Cookie header value. */
  toHeader() {
    const parts = []
    const value = encodeURIComponent(this.rawValue())

    parts.push(`${this._name}=${value}`)

    if (this._options.domain) parts.push(`Domain=${this._options.domain}`)
    if (this._options.path) parts.push(`Path=${this._options.path}`)
    if (this._options.expires instanceof Date) parts.push(`Expires=${this._options.expires.toUTCString()}`)
    if (typeof this._options.maxAge === "number") parts.push(`Max-Age=${this._options.maxAge}`)
    if (this._options.httpOnly) parts.push("HttpOnly")
    if (this._options.secure) parts.push("Secure")
    if (this._options.sameSite) parts.push(`SameSite=${this._options.sameSite}`)

    return parts.join("; ")
  }

  /**
   * @param {string | undefined | null} headerValue - Cookie header.
   * @param {string | undefined} secret - Encryption secret.
   * @returns {Cookie[]} - Cookie list.
   */
  static parseHeader(headerValue, secret) {
    if (!headerValue) return []

    return headerValue.split(";").map((pair) => pair.trim()).filter(Boolean).map((pair) => {
      const [name, ...rest] = pair.split("=")
      const rawValue = rest.join("=")
      let value = rawValue

      try {
        value = decodeURIComponent(rawValue)
      } catch {
        // Use raw value when decoding fails.
      }

      if (value.startsWith("enc:v1:")) {
        if (!secret) {
          return new Cookie({name, value: "", rawValue: value, encrypted: true, error: new Error("No cookie secret configured")})
        }

        try {
          const decryptedValue = this.decryptValue(value, secret)
          return new Cookie({name, value: decryptedValue, rawValue: value, encrypted: true})
        } catch (error) {
          const ensuredError = error instanceof Error ? error : new Error(String(error))
          return new Cookie({name, value: "", rawValue: value, encrypted: true, error: ensuredError})
        }
      }

      return new Cookie({name, value, rawValue: value})
    })
  }

  /**
   * @param {unknown} value - Value to encrypt.
   * @param {string} secret - Encryption secret.
   * @returns {string} - Encrypted value.
   */
  static encryptValue(value, secret) {
    if (!secret) throw new Error("No cookie secret configured")

    const {payload, type} = this._serializeEncryptedValue(value)
    const iv = crypto.randomBytes(12)
    const key = this._deriveKey(secret)
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
    const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()])
    const authTag = cipher.getAuthTag()

    return `enc:v1:${type}.${this._toBase64Url(iv)}.${this._toBase64Url(authTag)}.${this._toBase64Url(encrypted)}`
  }

  /**
   * @param {string} value - Encrypted value.
   * @param {string} secret - Encryption secret.
   * @returns {string} - Decrypted value.
   */
  static decryptValue(value, secret) {
    if (!secret) throw new Error("No cookie secret configured")
    if (!value.startsWith("enc:v1:")) return value

    const payload = value.slice("enc:v1:".length)
    const [type, ivEncoded, tagEncoded, dataEncoded] = payload.split(".")

    if (!type || !ivEncoded || !tagEncoded || !dataEncoded) {
      throw new Error("Invalid encrypted cookie format")
    }

    const iv = this._fromBase64Url(ivEncoded)
    const authTag = this._fromBase64Url(tagEncoded)
    const data = this._fromBase64Url(dataEncoded)
    const key = this._deriveKey(secret)
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)

    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")

    return this._deserializeEncryptedValue(type, decrypted)
  }

  /**
   * @param {unknown} value - Value to serialize.
   * @returns {{payload: string, type: string}} - Serialized payload.
   */
  static _serializeEncryptedValue(value) {
    if (typeof value === "string") return {payload: value, type: "s"}
    if (value === undefined) return {payload: "", type: "s"}

    try {
      const payload = JSON.stringify(value)

      if (payload === undefined) {
        return {payload: String(value), type: "s"}
      }

      return {payload, type: "j"}
    } catch {
      return {payload: String(value), type: "s"}
    }
  }

  /**
   * @param {string} type - Serialized type.
   * @param {string} payload - Payload.
   * @returns {string} - Deserialized value.
   */
  static _deserializeEncryptedValue(type, payload) {
    if (type === "j") {
      try {
        const parsed = JSON.parse(payload)
        return typeof parsed === "string" ? parsed : JSON.stringify(parsed)
      } catch {
        return payload
      }
    }

    return payload
  }

  /**
   * @param {string} secret - Secret.
   * @returns {Buffer} - Key.
   */
  static _deriveKey(secret) {
    return crypto.createHash("sha256").update(secret).digest()
  }

  /**
   * @param {Buffer} buffer - Buffer.
   * @returns {string} - Base64 URL encoded string.
   */
  static _toBase64Url(buffer) {
    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
  }

  /**
   * @param {string} value - Base64 URL encoded string.
   * @returns {Buffer} - Buffer.
   */
  static _fromBase64Url(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4))

    return Buffer.from(`${normalized}${padding}`, "base64")
  }
}
