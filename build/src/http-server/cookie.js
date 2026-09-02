// @ts-check
import crypto from "crypto";
export default class Cookie {
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
    constructor({ name, value, rawValue, options, encrypted = false, error }) {
        this._name = name;
        this._value = value ?? "";
        this._rawValue = rawValue ?? this._value;
        this._options = options || {};
        this._encrypted = encrypted;
        this._error = error;
    }
    /**
     * Runs name.
     * @returns {string} - Cookie name.
     */
    name() { return this._name; }
    /**
     * Runs value.
     * @returns {string} - Cookie value (decrypted when available).
     */
    value() { return String(this._value ?? ""); }
    /**
     * Runs raw value.
     * @returns {string} - Raw cookie value.
     */
    rawValue() { return String(this._rawValue ?? ""); }
    /**
     * Runs is encrypted.
     * @returns {boolean} - Whether cookie is encrypted.
     */
    isEncrypted() { return Boolean(this._encrypted); }
    /**
     * Runs error.
     * @returns {Error | undefined} - Decryption error.
     */
    error() { return this._error; }
    /**
     * Runs to header.
     * @returns {string} - Set-Cookie header value.
     */
    toHeader() {
        const parts = [];
        const value = encodeURIComponent(this.rawValue());
        parts.push(`${this._name}=${value}`);
        if (this._options.domain)
            parts.push(`Domain=${this._options.domain}`);
        if (this._options.path)
            parts.push(`Path=${this._options.path}`);
        if (this._options.expires instanceof Date)
            parts.push(`Expires=${this._options.expires.toUTCString()}`);
        if (typeof this._options.maxAge === "number")
            parts.push(`Max-Age=${this._options.maxAge}`);
        if (this._options.httpOnly)
            parts.push("HttpOnly");
        if (this._options.secure)
            parts.push("Secure");
        if (this._options.sameSite)
            parts.push(`SameSite=${this._options.sameSite}`);
        return parts.join("; ");
    }
    /**
     * Runs parse header.
     * @param {string | undefined | null} headerValue - Cookie header.
     * @param {string | undefined} secret - Encryption secret.
     * @returns {Cookie[]} - Cookie list.
     */
    static parseHeader(headerValue, secret) {
        if (!headerValue)
            return [];
        return headerValue.split(";").map((pair) => pair.trim()).filter(Boolean).map((pair) => {
            const [name, ...rest] = pair.split("=");
            const rawValue = rest.join("=");
            let value = rawValue;
            try {
                value = decodeURIComponent(rawValue);
            }
            catch {
                // Use raw value when decoding fails.
            }
            if (value.startsWith("enc:v1:")) {
                if (!secret) {
                    return new Cookie({ name, value: "", rawValue: value, encrypted: true, error: new Error("No cookie secret configured") });
                }
                try {
                    const decryptedValue = this.decryptValue(value, secret);
                    return new Cookie({ name, value: decryptedValue, rawValue: value, encrypted: true });
                }
                catch (error) {
                    const ensuredError = error instanceof Error ? error : new Error(String(error));
                    return new Cookie({ name, value: "", rawValue: value, encrypted: true, error: ensuredError });
                }
            }
            return new Cookie({ name, value, rawValue: value });
        });
    }
    /**
     * Runs encrypt value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to encrypt.
     * @param {string} secret - Encryption secret.
     * @returns {string} - Encrypted value.
     */
    static encryptValue(value, secret) {
        if (!secret)
            throw new Error("No cookie secret configured");
        const { payload, type } = this._serializeEncryptedValue(value);
        const iv = crypto.randomBytes(12);
        const key = this._deriveKey(secret);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return `enc:v1:${type}.${this._toBase64Url(iv)}.${this._toBase64Url(authTag)}.${this._toBase64Url(encrypted)}`;
    }
    /**
     * Runs decrypt value.
     * @param {string} value - Encrypted value.
     * @param {string} secret - Encryption secret.
     * @returns {string} - Decrypted value.
     */
    static decryptValue(value, secret) {
        if (!secret)
            throw new Error("No cookie secret configured");
        if (!value.startsWith("enc:v1:"))
            return value;
        const payload = value.slice("enc:v1:".length);
        const [type, ivEncoded, tagEncoded, dataEncoded] = payload.split(".");
        if (!type || !ivEncoded || !tagEncoded || !dataEncoded) {
            throw new Error("Invalid encrypted cookie format");
        }
        const iv = this._fromBase64Url(ivEncoded);
        const authTag = this._fromBase64Url(tagEncoded);
        const data = this._fromBase64Url(dataEncoded);
        const key = this._deriveKey(secret);
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
        return this._deserializeEncryptedValue(type, decrypted);
    }
    /**
     * Runs serialize encrypted value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to serialize.
     * @returns {{payload: string, type: string}} - Serialized payload.
     */
    static _serializeEncryptedValue(value) {
        if (typeof value === "string")
            return { payload: value, type: "s" };
        if (value === undefined)
            return { payload: "", type: "s" };
        try {
            const payload = JSON.stringify(value);
            if (payload === undefined) {
                return { payload: String(value), type: "s" };
            }
            return { payload, type: "j" };
        }
        catch {
            return { payload: String(value), type: "s" };
        }
    }
    /**
     * Runs deserialize encrypted value.
     * @param {string} type - Serialized type.
     * @param {string} payload - Payload.
     * @returns {string} - Deserialized value.
     */
    static _deserializeEncryptedValue(type, payload) {
        if (type === "j") {
            try {
                const parsed = JSON.parse(payload);
                return typeof parsed === "string" ? parsed : JSON.stringify(parsed);
            }
            catch {
                return payload;
            }
        }
        return payload;
    }
    /**
     * Runs derive key.
     * @param {string} secret - Secret.
     * @returns {Buffer} - Key.
     */
    static _deriveKey(secret) {
        return crypto.createHash("sha256").update(secret).digest();
    }
    /**
     * Runs to base64 url.
     * @param {Buffer} buffer - Buffer.
     * @returns {string} - Base64 URL encoded string.
     */
    static _toBase64Url(buffer) {
        return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }
    /**
     * Runs from base64 url.
     * @param {string} value - Base64 URL encoded string.
     * @returns {Buffer} - Buffer.
     */
    static _fromBase64Url(value) {
        const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
        const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
        return Buffer.from(`${normalized}${padding}`, "base64");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29va2llLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2h0dHAtc2VydmVyL2Nvb2tpZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxNQUFNLE1BQU0sUUFBUSxDQUFBO0FBRTNCLE1BQU0sQ0FBQyxPQUFPLE9BQU8sTUFBTTtJQUN6Qjs7Ozs7Ozs7OztPQVVHO0lBRUg7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxTQUFTLEdBQUcsS0FBSyxFQUFFLEtBQUssRUFBQztRQUNwRSxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQTtRQUNqQixJQUFJLENBQUMsTUFBTSxHQUFHLEtBQUssSUFBSSxFQUFFLENBQUE7UUFDekIsSUFBSSxDQUFDLFNBQVMsR0FBRyxRQUFRLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQTtRQUN4QyxJQUFJLENBQUMsUUFBUSxHQUFHLE9BQU8sSUFBSSxFQUFFLENBQUE7UUFDN0IsSUFBSSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7UUFDM0IsSUFBSSxDQUFDLE1BQU0sR0FBRyxLQUFLLENBQUE7SUFDckIsQ0FBQztJQUVEOzs7T0FHRztJQUNILElBQUksS0FBSyxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRTVCOzs7T0FHRztJQUNILEtBQUssS0FBSyxPQUFPLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUU1Qzs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFbEQ7OztPQUdHO0lBQ0gsV0FBVyxLQUFLLE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFF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LENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUM5RixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxjQUFjLENBQUMsS0FBSztRQUN6QixNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxDQUFBO1FBQzlELE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUUxRixPQUFPLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxVQUFVLEdBQUcsT0FBTyxFQUFFLEVBQUUsUUFBUSxDQUFDLENBQUE7SUFDekQsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBjcnlwdG8gZnJvbSBcImNyeXB0b1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIENvb2tpZSB7XG4gIC8qKlxuICAgKiBDb29raWVPcHRpb25zIHR5cGUuXG4gICAqIEB0eXBlZGVmIHtvYmplY3R9IENvb2tpZU9wdGlvbnNcbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFtkb21haW5dIC0gRG9tYWluLlxuICAgKiBAcHJvcGVydHkge0RhdGV9IFtleHBpcmVzXSAtIEV4cGlyZXMgZGF0ZS5cbiAgICogQHByb3BlcnR5IHtib29sZWFufSBbaHR0cE9ubHldIC0gSHR0cE9ubHkgZmxhZy5cbiAgICogQHByb3BlcnR5IHtudW1iZXJ9IFttYXhBZ2VdIC0gTWF4LUFnZSBpbiBzZWNvbmRzLlxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW3BhdGhdIC0gUGF0aC5cbiAgICogQHByb3BlcnR5IHtib29sZWFufSBbc2VjdXJlXSAtIFNlY3VyZSBmbGFnLlxuICAgKiBAcHJvcGVydHkge1wiTGF4XCIgfCBcIlN0cmljdFwiIHwgXCJOb25lXCJ9IFtzYW1lU2l0ZV0gLSBTYW1lU2l0ZSB2YWx1ZS5cbiAgICovXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBDb29raWUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsfSBhcmdzLnZhbHVlIC0gQ29va2llIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZCB8IG51bGx9IFthcmdzLnJhd1ZhbHVlXSAtIFJhdyBjb29raWUgdmFsdWUuXG4gICAqIEBwYXJhbSB7Q29va2llT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBDb29raWUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5lbmNyeXB0ZWRdIC0gV2hldGhlciBjb29raWUgaXMgZW5jcnlwdGVkLlxuICAgKiBAcGFyYW0ge0Vycm9yIHwgdW5kZWZpbmVkfSBbYXJncy5lcnJvcl0gLSBEZWNyeXB0aW9uIGVycm9yLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe25hbWUsIHZhbHVlLCByYXdWYWx1ZSwgb3B0aW9ucywgZW5jcnlwdGVkID0gZmFsc2UsIGVycm9yfSkge1xuICAgIHRoaXMuX25hbWUgPSBuYW1lXG4gICAgdGhpcy5fdmFsdWUgPSB2YWx1ZSA/PyBcIlwiXG4gICAgdGhpcy5fcmF3VmFsdWUgPSByYXdWYWx1ZSA/PyB0aGlzLl92YWx1ZVxuICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9XG4gICAgdGhpcy5fZW5jcnlwdGVkID0gZW5jcnlwdGVkXG4gICAgdGhpcy5fZXJyb3IgPSBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDb29raWUgbmFtZS5cbiAgICovXG4gIG5hbWUoKSB7IHJldHVybiB0aGlzLl9uYW1lIH1cblxuICAvKipcbiAgICogUnVucyB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDb29raWUgdmFsdWUgKGRlY3J5cHRlZCB3aGVuIGF2YWlsYWJsZSkuXG4gICAqL1xuICB2YWx1ZSgpIHsgcmV0dXJuIFN0cmluZyh0aGlzLl92YWx1ZSA/PyBcIlwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmF3IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJhdyBjb29raWUgdmFsdWUuXG4gICAqL1xuICByYXdWYWx1ZSgpIHsgcmV0dXJuIFN0cmluZyh0aGlzLl9yYXdWYWx1ZSA/PyBcIlwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZW5jcnlwdGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGNvb2tpZSBpcyBlbmNyeXB0ZWQuXG4gICAqL1xuICBpc0VuY3J5cHRlZCgpIHsgcmV0dXJuIEJvb2xlYW4odGhpcy5fZW5jcnlwdGVkKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtFcnJvciB8IHVuZGVmaW5lZH0gLSBEZWNyeXB0aW9uIGVycm9yLlxuICAgKi9cbiAgZXJyb3IoKSB7IHJldHVybiB0aGlzLl9lcnJvciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gaGVhZGVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNldC1Db29raWUgaGVhZGVyIHZhbHVlLlxuICAgKi9cbiAgdG9IZWFkZXIoKSB7XG4gICAgY29uc3QgcGFydHMgPSBbXVxuICAgIGNvbnN0IHZhbHVlID0gZW5jb2RlVVJJQ29tcG9uZW50KHRoaXMucmF3VmFsdWUoKSlcblxuICAgIHBhcnRzLnB1c2goYCR7dGhpcy5fbmFtZX09JHt2YWx1ZX1gKVxuXG4gICAgaWYgKHRoaXMuX29wdGlvbnMuZG9tYWluKSBwYXJ0cy5wdXNoKGBEb21haW49JHt0aGlzLl9vcHRpb25zLmRvbWFpbn1gKVxuICAgIGlmICh0aGlzLl9vcHRpb25zLnBhdGgpIHBhcnRzLnB1c2goYFBhdGg9JHt0aGlzLl9vcHRpb25zLnBhdGh9YClcbiAgICBpZiAodGhpcy5fb3B0aW9ucy5leHBpcmVzIGluc3RhbmNlb2YgRGF0ZSkgcGFydHMucHVzaChgRXhwaXJlcz0ke3RoaXMuX29wdGlvbnMuZXhwaXJlcy50b1VUQ1N0cmluZygpfWApXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9vcHRpb25zLm1heEFnZSA9PT0gXCJudW1iZXJcIikgcGFydHMucHVzaChgTWF4LUFnZT0ke3RoaXMuX29wdGlvbnMubWF4QWdlfWApXG4gICAgaWYgKHRoaXMuX29wdGlvbnMuaHR0cE9ubHkpIHBhcnRzLnB1c2goXCJIdHRwT25seVwiKVxuICAgIGlmICh0aGlzLl9vcHRpb25zLnNlY3VyZSkgcGFydHMucHVzaChcIlNlY3VyZVwiKVxuICAgIGlmICh0aGlzLl9vcHRpb25zLnNhbWVTaXRlKSBwYXJ0cy5wdXNoKGBTYW1lU2l0ZT0ke3RoaXMuX29wdGlvbnMuc2FtZVNpdGV9YClcblxuICAgIHJldHVybiBwYXJ0cy5qb2luKFwiOyBcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIGhlYWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsfSBoZWFkZXJWYWx1ZSAtIENvb2tpZSBoZWFkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBzZWNyZXQgLSBFbmNyeXB0aW9uIHNlY3JldC5cbiAgICogQHJldHVybnMge0Nvb2tpZVtdfSAtIENvb2tpZSBsaXN0LlxuICAgKi9cbiAgc3RhdGljIHBhcnNlSGVhZGVyKGhlYWRlclZhbHVlLCBzZWNyZXQpIHtcbiAgICBpZiAoIWhlYWRlclZhbHVlKSByZXR1cm4gW11cblxuICAgIHJldHVybiBoZWFkZXJWYWx1ZS5zcGxpdChcIjtcIikubWFwKChwYWlyKSA9PiBwYWlyLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pLm1hcCgocGFpcikgPT4ge1xuICAgICAgY29uc3QgW25hbWUsIC4uLnJlc3RdID0gcGFpci5zcGxpdChcIj1cIilcbiAgICAgIGNvbnN0IHJhd1ZhbHVlID0gcmVzdC5qb2luKFwiPVwiKVxuICAgICAgbGV0IHZhbHVlID0gcmF3VmFsdWVcblxuICAgICAgdHJ5IHtcbiAgICAgICAgdmFsdWUgPSBkZWNvZGVVUklDb21wb25lbnQocmF3VmFsdWUpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gVXNlIHJhdyB2YWx1ZSB3aGVuIGRlY29kaW5nIGZhaWxzLlxuICAgICAgfVxuXG4gICAgICBpZiAodmFsdWUuc3RhcnRzV2l0aChcImVuYzp2MTpcIikpIHtcbiAgICAgICAgaWYgKCFzZWNyZXQpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IENvb2tpZSh7bmFtZSwgdmFsdWU6IFwiXCIsIHJhd1ZhbHVlOiB2YWx1ZSwgZW5jcnlwdGVkOiB0cnVlLCBlcnJvcjogbmV3IEVycm9yKFwiTm8gY29va2llIHNlY3JldCBjb25maWd1cmVkXCIpfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgZGVjcnlwdGVkVmFsdWUgPSB0aGlzLmRlY3J5cHRWYWx1ZSh2YWx1ZSwgc2VjcmV0KVxuICAgICAgICAgIHJldHVybiBuZXcgQ29va2llKHtuYW1lLCB2YWx1ZTogZGVjcnlwdGVkVmFsdWUsIHJhd1ZhbHVlOiB2YWx1ZSwgZW5jcnlwdGVkOiB0cnVlfSlcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjb25zdCBlbnN1cmVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgICAgICByZXR1cm4gbmV3IENvb2tpZSh7bmFtZSwgdmFsdWU6IFwiXCIsIHJhd1ZhbHVlOiB2YWx1ZSwgZW5jcnlwdGVkOiB0cnVlLCBlcnJvcjogZW5zdXJlZEVycm9yfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gbmV3IENvb2tpZSh7bmFtZSwgdmFsdWUsIHJhd1ZhbHVlOiB2YWx1ZX0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuY3J5cHQgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gZW5jcnlwdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlY3JldCAtIEVuY3J5cHRpb24gc2VjcmV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEVuY3J5cHRlZCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBlbmNyeXB0VmFsdWUodmFsdWUsIHNlY3JldCkge1xuICAgIGlmICghc2VjcmV0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb29raWUgc2VjcmV0IGNvbmZpZ3VyZWRcIilcblxuICAgIGNvbnN0IHtwYXlsb2FkLCB0eXBlfSA9IHRoaXMuX3NlcmlhbGl6ZUVuY3J5cHRlZFZhbHVlKHZhbHVlKVxuICAgIGNvbnN0IGl2ID0gY3J5cHRvLnJhbmRvbUJ5dGVzKDEyKVxuICAgIGNvbnN0IGtleSA9IHRoaXMuX2Rlcml2ZUtleShzZWNyZXQpXG4gICAgY29uc3QgY2lwaGVyID0gY3J5cHRvLmNyZWF0ZUNpcGhlcml2KFwiYWVzLTI1Ni1nY21cIiwga2V5LCBpdilcbiAgICBjb25zdCBlbmNyeXB0ZWQgPSBCdWZmZXIuY29uY2F0KFtjaXBoZXIudXBkYXRlKHBheWxvYWQsIFwidXRmOFwiKSwgY2lwaGVyLmZpbmFsKCldKVxuICAgIGNvbnN0IGF1dGhUYWcgPSBjaXBoZXIuZ2V0QXV0aFRhZygpXG5cbiAgICByZXR1cm4gYGVuYzp2MToke3R5cGV9LiR7dGhpcy5fdG9CYXNlNjRVcmwoaXYpfS4ke3RoaXMuX3RvQmFzZTY0VXJsKGF1dGhUYWcpfS4ke3RoaXMuX3RvQmFzZTY0VXJsKGVuY3J5cHRlZCl9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVjcnlwdCB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gRW5jcnlwdGVkIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2VjcmV0IC0gRW5jcnlwdGlvbiBzZWNyZXQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVjcnlwdGVkIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGRlY3J5cHRWYWx1ZSh2YWx1ZSwgc2VjcmV0KSB7XG4gICAgaWYgKCFzZWNyZXQpIHRocm93IG5ldyBFcnJvcihcIk5vIGNvb2tpZSBzZWNyZXQgY29uZmlndXJlZFwiKVxuICAgIGlmICghdmFsdWUuc3RhcnRzV2l0aChcImVuYzp2MTpcIikpIHJldHVybiB2YWx1ZVxuXG4gICAgY29uc3QgcGF5bG9hZCA9IHZhbHVlLnNsaWNlKFwiZW5jOnYxOlwiLmxlbmd0aClcbiAgICBjb25zdCBbdHlwZSwgaXZFbmNvZGVkLCB0YWdFbmNvZGVkLCBkYXRhRW5jb2RlZF0gPSBwYXlsb2FkLnNwbGl0KFwiLlwiKVxuXG4gICAgaWYgKCF0eXBlIHx8ICFpdkVuY29kZWQgfHwgIXRhZ0VuY29kZWQgfHwgIWRhdGFFbmNvZGVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIGVuY3J5cHRlZCBjb29raWUgZm9ybWF0XCIpXG4gICAgfVxuXG4gICAgY29uc3QgaXYgPSB0aGlzLl9mcm9tQmFzZTY0VXJsKGl2RW5jb2RlZClcbiAgICBjb25zdCBhdXRoVGFnID0gdGhpcy5fZnJvbUJhc2U2NFVybCh0YWdFbmNvZGVkKVxuICAgIGNvbnN0IGRhdGEgPSB0aGlzLl9mcm9tQmFzZTY0VXJsKGRhdGFFbmNvZGVkKVxuICAgIGNvbnN0IGtleSA9IHRoaXMuX2Rlcml2ZUtleShzZWNyZXQpXG4gICAgY29uc3QgZGVjaXBoZXIgPSBjcnlwdG8uY3JlYXRlRGVjaXBoZXJpdihcImFlcy0yNTYtZ2NtXCIsIGtleSwgaXYpXG5cbiAgICBkZWNpcGhlci5zZXRBdXRoVGFnKGF1dGhUYWcpXG5cbiAgICBjb25zdCBkZWNyeXB0ZWQgPSBCdWZmZXIuY29uY2F0KFtkZWNpcGhlci51cGRhdGUoZGF0YSksIGRlY2lwaGVyLmZpbmFsKCldKS50b1N0cmluZyhcInV0ZjhcIilcblxuICAgIHJldHVybiB0aGlzLl9kZXNlcmlhbGl6ZUVuY3J5cHRlZFZhbHVlKHR5cGUsIGRlY3J5cHRlZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlcmlhbGl6ZSBlbmNyeXB0ZWQgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gc2VyaWFsaXplLlxuICAgKiBAcmV0dXJucyB7e3BheWxvYWQ6IHN0cmluZywgdHlwZTogc3RyaW5nfX0gLSBTZXJpYWxpemVkIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgX3NlcmlhbGl6ZUVuY3J5cHRlZFZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHtwYXlsb2FkOiB2YWx1ZSwgdHlwZTogXCJzXCJ9XG4gICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB7cGF5bG9hZDogXCJcIiwgdHlwZTogXCJzXCJ9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcGF5bG9hZCA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKVxuXG4gICAgICBpZiAocGF5bG9hZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7cGF5bG9hZDogU3RyaW5nKHZhbHVlKSwgdHlwZTogXCJzXCJ9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7cGF5bG9hZCwgdHlwZTogXCJqXCJ9XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4ge3BheWxvYWQ6IFN0cmluZyh2YWx1ZSksIHR5cGU6IFwic1wifVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlc2VyaWFsaXplIGVuY3J5cHRlZCB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBTZXJpYWxpemVkIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEZXNlcmlhbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX2Rlc2VyaWFsaXplRW5jcnlwdGVkVmFsdWUodHlwZSwgcGF5bG9hZCkge1xuICAgIGlmICh0eXBlID09PSBcImpcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShwYXlsb2FkKVxuICAgICAgICByZXR1cm4gdHlwZW9mIHBhcnNlZCA9PT0gXCJzdHJpbmdcIiA/IHBhcnNlZCA6IEpTT04uc3RyaW5naWZ5KHBhcnNlZClcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gcGF5bG9hZFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZXJpdmUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2VjcmV0IC0gU2VjcmV0LlxuICAgKiBAcmV0dXJucyB7QnVmZmVyfSAtIEtleS5cbiAgICovXG4gIHN0YXRpYyBfZGVyaXZlS2V5KHNlY3JldCkge1xuICAgIHJldHVybiBjcnlwdG8uY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoc2VjcmV0KS5kaWdlc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYmFzZTY0IHVybC5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGJ1ZmZlciAtIEJ1ZmZlci5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBCYXNlNjQgVVJMIGVuY29kZWQgc3RyaW5nLlxuICAgKi9cbiAgc3RhdGljIF90b0Jhc2U2NFVybChidWZmZXIpIHtcbiAgICByZXR1cm4gYnVmZmVyLnRvU3RyaW5nKFwiYmFzZTY0XCIpLnJlcGxhY2UoL1xcKy9nLCBcIi1cIikucmVwbGFjZSgvXFwvL2csIFwiX1wiKS5yZXBsYWNlKC89KyQvZywgXCJcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb20gYmFzZTY0IHVybC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gQmFzZTY0IFVSTCBlbmNvZGVkIHN0cmluZy5cbiAgICogQHJldHVybnMge0J1ZmZlcn0gLSBCdWZmZXIuXG4gICAqL1xuICBzdGF0aWMgX2Zyb21CYXNlNjRVcmwodmFsdWUpIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gdmFsdWUucmVwbGFjZSgvLS9nLCBcIitcIikucmVwbGFjZSgvXy9nLCBcIi9cIilcbiAgICBjb25zdCBwYWRkaW5nID0gbm9ybWFsaXplZC5sZW5ndGggJSA0ID09PSAwID8gXCJcIiA6IFwiPVwiLnJlcGVhdCg0IC0gKG5vcm1hbGl6ZWQubGVuZ3RoICUgNCkpXG5cbiAgICByZXR1cm4gQnVmZmVyLmZyb20oYCR7bm9ybWFsaXplZH0ke3BhZGRpbmd9YCwgXCJiYXNlNjRcIilcbiAgfVxufVxuIl19