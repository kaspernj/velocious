export type CookieOptions = {
    /**
     * - Domain.
     */
    domain?: string;
    /**
     * - Expires date.
     */
    expires?: Date;
    /**
     * - HttpOnly flag.
     */
    httpOnly?: boolean;
    /**
     * - Max-Age in seconds.
     */
    maxAge?: number;
    /**
     * - Path.
     */
    path?: string;
    /**
     * - Secure flag.
     */
    secure?: boolean;
    /**
     * - SameSite value.
     */
    sameSite?: "Lax" | "Strict" | "None";
};
export default class Cookie {
    _name: string;
    _value: string;
    _rawValue: string;
    _options: CookieOptions;
    _encrypted: boolean;
    _error: Error | undefined;
    /**
     * CookieOptions type.
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
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.name - Cookie name.
     * @param {string | undefined | null} args.value - Cookie value.
     * @param {string | undefined | null} [args.rawValue] - Raw cookie value.
     * @param {CookieOptions} [args.options] - Cookie options.
     * @param {boolean} [args.encrypted] - Whether cookie is encrypted.
     * @param {Error | undefined} [args.error] - Decryption error.
     */
    constructor({ name, value, rawValue, options, encrypted, error }: {
        name: string;
        value: string | undefined | null;
        rawValue?: string | undefined | null;
        options?: CookieOptions;
        encrypted?: boolean;
        error?: Error | undefined;
    });
    /**
     * Runs name.
     * @returns {string} - Cookie name.
     */
    name(): string;
    /**
     * Runs value.
     * @returns {string} - Cookie value (decrypted when available).
     */
    value(): string;
    /**
     * Runs raw value.
     * @returns {string} - Raw cookie value.
     */
    rawValue(): string;
    /**
     * Runs is encrypted.
     * @returns {boolean} - Whether cookie is encrypted.
     */
    isEncrypted(): boolean;
    /**
     * Runs error.
     * @returns {Error | undefined} - Decryption error.
     */
    error(): Error | undefined;
    /**
     * Runs to header.
     * @returns {string} - Set-Cookie header value.
     */
    toHeader(): string;
    /**
     * Runs parse header.
     * @param {string | undefined | null} headerValue - Cookie header.
     * @param {string | undefined} secret - Encryption secret.
     * @returns {Cookie[]} - Cookie list.
     */
    static parseHeader(headerValue: string | undefined | null, secret: string | undefined): Cookie[];
    /**
     * Runs encrypt value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to encrypt.
     * @param {string} secret - Encryption secret.
     * @returns {string} - Encrypted value.
     */
    static encryptValue(value: ReturnType<typeof JSON.parse>, secret: string): string;
    /**
     * Runs decrypt value.
     * @param {string} value - Encrypted value.
     * @param {string} secret - Encryption secret.
     * @returns {string} - Decrypted value.
     */
    static decryptValue(value: string, secret: string): string;
    /**
     * Runs serialize encrypted value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to serialize.
     * @returns {{payload: string, type: string}} - Serialized payload.
     */
    static _serializeEncryptedValue(value: ReturnType<typeof JSON.parse>): {
        payload: string;
        type: string;
    };
    /**
     * Runs deserialize encrypted value.
     * @param {string} type - Serialized type.
     * @param {string} payload - Payload.
     * @returns {string} - Deserialized value.
     */
    static _deserializeEncryptedValue(type: string, payload: string): string;
    /**
     * Runs derive key.
     * @param {string} secret - Secret.
     * @returns {Buffer} - Key.
     */
    static _deriveKey(secret: string): Buffer;
    /**
     * Runs to base64 url.
     * @param {Buffer} buffer - Buffer.
     * @returns {string} - Base64 URL encoded string.
     */
    static _toBase64Url(buffer: Buffer): string;
    /**
     * Runs from base64 url.
     * @param {string} value - Base64 URL encoded string.
     * @returns {Buffer} - Buffer.
     */
    static _fromBase64Url(value: string): Buffer;
}
//# sourceMappingURL=cookie.d.ts.map