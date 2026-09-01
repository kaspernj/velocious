// @ts-check
import zlib from "node:zlib";
import { promisify } from "node:util";
const brotliCompressAsync = promisify(zlib.brotliCompress);
const gzipAsync = promisify(zlib.gzip);
/**
 * Exact media types (beyond the text/*, *+json, and *+xml families) that are worth compressing.
 * Everything else — unknown binary types and commonly pre-compressed media such as images,
 * video, and archives — is left untouched by the conservative allowlist.
 * @type {Set<string>} */
const COMPRESSIBLE_EXACT_MEDIA_TYPES = new Set([
    "application/ecmascript",
    "application/javascript",
    "application/json",
    "application/x-javascript",
    "application/xml",
    "image/svg+xml"
]);
/**
 * RFC 9110 §12.4.2 qvalue grammar: `0` or `1` with at most three fractional
 * digits, and only zeros after `1`.
 * @type {RegExp} */
const QVALUE_PATTERN = /^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/u;
/**
 * Runs parse accept encoding.
 * @param {string} headerValue - Accept-Encoding header value.
 * @returns {Map<string, number>} - Lowercased coding to q-value (0-1).
 */
export function parseAcceptEncoding(headerValue) {
    /** @type {Map<string, number>} */
    const codings = new Map();
    for (const part of headerValue.split(",")) {
        const [codingToken, ...parameters] = part.split(";");
        const coding = codingToken?.trim().toLowerCase();
        if (!coding)
            continue;
        let q = 1;
        for (const parameter of parameters) {
            const [name, value] = parameter.split("=");
            if (name?.trim().toLowerCase() != "q")
                continue;
            const qvalue = value?.trim() || "";
            // A malformed q-value (e.g. `.5`, `01`, `1.001`, more than three fractional
            // digits, or empty) is treated as "not acceptable" (q=0), per RFC 9110 §12.4.2.
            q = QVALUE_PATTERN.test(qvalue) ? Number(qvalue) : 0;
        }
        codings.set(coding, q);
    }
    return codings;
}
/**
 * Negotiates the content coding for a response from the Accept-Encoding header.
 * Identity participates in the same quality comparison as the supported codings:
 * a higher-q identity selects identity, and equal-q ties break in server order
 * br, gzip, identity. Identity defaults to acceptable unless explicitly refused
 * with `identity;q=0` or a `*;q=0` wildcard without a more specific identity
 * entry, and an explicit coding entry beats the wildcard.
 * @param {string | null | undefined} acceptEncoding - Accept-Encoding header value.
 * @returns {{encoding: "br" | "gzip" | "identity", identityAcceptable: boolean} | {notAcceptable: true}} - Negotiated coding, or that no acceptable representation exists.
 */
export function negotiateContentEncoding(acceptEncoding) {
    if (acceptEncoding === undefined || acceptEncoding === null || acceptEncoding.trim() === "") {
        return { encoding: "identity", identityAcceptable: true };
    }
    const codings = parseAcceptEncoding(acceptEncoding);
    const wildcardQ = codings.get("*");
    const identityQ = codings.get("identity") ?? wildcardQ ?? 1;
    // Declared in server preference order; the stable sort keeps this order for ties.
    /** @type {Array<{coding: "br" | "gzip" | "identity", q: number}>} */
    const candidates = [
        { coding: "br", q: codings.get("br") ?? wildcardQ ?? 0 },
        { coding: "gzip", q: codings.get("gzip") ?? wildcardQ ?? 0 },
        { coding: "identity", q: identityQ }
    ];
    const selected = candidates
        .filter((candidate) => candidate.q > 0)
        .sort((a, b) => b.q - a.q)[0];
    if (!selected)
        return { notAcceptable: true };
    return { encoding: selected.coding, identityAcceptable: identityQ > 0 };
}
/**
 * Runs is compressible content type.
 * @param {string} contentType - Content-Type header value.
 * @returns {boolean} - Whether the media type is on the compressible allowlist.
 */
export function isCompressibleContentType(contentType) {
    const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
    if (!mediaType)
        return false;
    // Server-sent events are long-lived streams; buffering them for compression
    // would break delivery, so they are excluded before the textual allowlist.
    if (mediaType == "text/event-stream")
        return false;
    if (mediaType.startsWith("text/"))
        return true;
    if (mediaType.endsWith("+json") || mediaType.endsWith("+xml"))
        return true;
    return COMPRESSIBLE_EXACT_MEDIA_TYPES.has(mediaType);
}
/**
 * Merges Accept-Encoding into the response Vary header case-insensitively and
 * without duplicates. An existing `Vary: *` already covers every request header
 * and is preserved as-is.
 * @param {import("./response.js").default} response - Response instance.
 * @returns {void} - No return value.
 */
export function addAcceptEncodingToVary(response) {
    for (const headerKey in response.headers) {
        if (headerKey.toLowerCase() != "vary")
            continue;
        const values = response.headers[headerKey];
        const tokens = values.flatMap((value) => value.split(",").map((token) => token.trim().toLowerCase()));
        if (tokens.includes("*") || tokens.includes("accept-encoding"))
            return;
        if (values.length > 0) {
            values[0] = `${values[0]}, Accept-Encoding`;
        }
        return;
    }
    response.setHeader("Vary", "Accept-Encoding");
}
/**
 * Negotiates and applies compression to a buffered response body immediately before
 * framing. Only string/Uint8Array responses reach this point; sendFile responses and
 * bodyless statuses are excluded by the caller. Transformation is skipped for
 * Cache-Control no-transform, non-allowlisted or pre-compressed media types,
 * server-sent events, partial (206) responses, requests with a Range header,
 * credentialed requests (Authorization/Cookie headers), responses carrying
 * credentials or validators (Set-Cookie/ETag/Digest/Content-Digest/Content-Range
 * headers), and per-response opt-outs; a skipped
 * transformation is still sent as identity when the client accepts identity, and
 * answered "not-acceptable" when it does not. Responses that already carry an
 * application-supplied Content-Encoding are passed through unchanged and never
 * negotiate. When the client forbids every representation (identity and all
 * supported codings), the outcome is "not-acceptable".
 * @param {object} args - Options object.
 * @param {Buffer} args.bodyBuffer - Buffered response body bytes (UTF-8 encoded for string bodies).
 * @param {import("../../configuration-types.js").NormalizedHttpCompressionConfiguration} args.compression - Normalized compression configuration.
 * @param {import("./request.js").default | import("./websocket-request.js").default} args.request - Request object.
 * @param {import("./response.js").default} args.response - Response instance.
 * @returns {Promise<{outcome: "identity"} | {outcome: "compressed", body: Buffer} | {outcome: "not-acceptable"}>} - Compression outcome.
 */
export async function applyResponseCompression({ bodyBuffer, compression, request, response }) {
    if (!compression.enabled)
        return { outcome: "identity" };
    // Application-supplied encodings stay application-owned: they are passed through
    // unchanged and never take part in negotiation failure handling.
    if (response.getHeader("Content-Encoding").length > 0)
        return { outcome: "identity" };
    const negotiated = negotiateContentEncoding(request.header("accept-encoding"));
    if ("notAcceptable" in negotiated)
        return { outcome: "not-acceptable" };
    const cacheControlTokens = response.getHeader("Cache-Control")
        .flatMap((value) => value.split(","))
        .map((token) => token.trim().toLowerCase());
    const contentType = response.getHeader("Content-Type")[0];
    // Automatic security exclusions: credentialed requests (Authorization/Cookie) and
    // responses carrying credentials (Set-Cookie) or representation validators
    // (ETag/Digest/Content-Digest) are never transformed — compression could leak
    // secret-bearing content through a compression oracle, and validators stay
    // application-owned rather than being recomputed for encoded variants.
    const transformable = !response.isCompressionDisabled() &&
        response.getStatusCode() !== 206 &&
        !request.header("range") &&
        !request.header("authorization") &&
        !request.header("cookie") &&
        response.getHeader("Content-Range").length === 0 &&
        response.getHeader("Set-Cookie").length === 0 &&
        response.getHeader("ETag").length === 0 &&
        response.getHeader("Digest").length === 0 &&
        response.getHeader("Content-Digest").length === 0 &&
        !cacheControlTokens.includes("no-transform") &&
        contentType !== undefined &&
        isCompressibleContentType(contentType);
    if (!transformable) {
        // A skipped transformation may still go out as identity when the client accepts
        // identity; when identity is forbidden, no acceptable representation can be sent.
        return negotiated.identityAcceptable ? { outcome: "identity" } : { outcome: "not-acceptable" };
    }
    // The representation now depends on the request's Accept-Encoding, even when this
    // particular response ends up identity (missing header, higher-q identity, below threshold).
    addAcceptEncodingToVary(response);
    if (negotiated.encoding == "identity")
        return { outcome: "identity" };
    // Below the threshold the smaller identity representation is sent instead — but only
    // when identity is acceptable; a client that forbids identity must never be forced
    // onto an unacceptable representation by the size check.
    if (bodyBuffer.length < compression.threshold && negotiated.identityAcceptable)
        return { outcome: "identity" };
    const body = negotiated.encoding == "br"
        ? await brotliCompressAsync(bodyBuffer, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: compression.brotliQuality } })
        : await gzipAsync(bodyBuffer, { level: compression.gzipLevel });
    response.setHeader("Content-Encoding", negotiated.encoding);
    return { body, outcome: "compressed" };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzcG9uc2UtY29tcHJlc3Npb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLWNvbXByZXNzaW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxFQUFDLFNBQVMsRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUVuQyxNQUFNLG1CQUFtQixHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7QUFDMUQsTUFBTSxTQUFTLEdBQUcsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtBQUV0Qzs7Ozt5QkFJeUI7QUFDekIsTUFBTSw4QkFBOEIsR0FBRyxJQUFJLEdBQUcsQ0FBQztJQUM3Qyx3QkFBd0I7SUFDeEIsd0JBQXdCO0lBQ3hCLGtCQUFrQjtJQUNsQiwwQkFBMEI7SUFDMUIsaUJBQWlCO0lBQ2pCLGVBQWU7Q0FDaEIsQ0FBQyxDQUFBO0FBRUY7OztvQkFHb0I7QUFDcEIsTUFBTSxjQUFjLEdBQUcsdUNBQXVDLENBQUE7QUFFOUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxtQkFBbUIsQ0FBQyxXQUFXO0lBQzdDLGtDQUFrQztJQUNsQyxNQUFNLE9BQU8sR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBRXpCLEtBQUssTUFBTSxJQUFJLElBQUksV0FBVyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsR0FBRyxVQUFVLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ3BELE1BQU0sTUFBTSxHQUFHLFdBQVcsRUFBRSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUVoRCxJQUFJLENBQUMsTUFBTTtZQUFFLFNBQVE7UUFFckIsSUFBSSxDQUFD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U0FBUyxJQUFJLFVBQVUsQ0FBQyxrQkFBa0I7UUFBRSxPQUFPLEVBQUMsT0FBTyxFQUFFLFVBQVUsRUFBQyxDQUFBO0lBRTVHLE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxRQUFRLElBQUksSUFBSTtRQUN0QyxDQUFDLENBQUMsTUFBTSxtQkFBbUIsQ0FBQyxVQUFVLEVBQUUsRUFBQyxNQUFNLEVBQUUsRUFBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsb0JBQW9CLENBQUMsRUFBRSxXQUFXLENBQUMsYUFBYSxFQUFDLEVBQUMsQ0FBQztRQUNySCxDQUFDLENBQUMsTUFBTSxTQUFTLENBQUMsVUFBVSxFQUFFLEVBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxTQUFTLEVBQUMsQ0FBQyxDQUFBO0lBRS9ELFFBQVEsQ0FBQyxTQUFTLENBQUMsa0JBQWtCLEVBQUUsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBRTNELE9BQU8sRUFBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBQyxDQUFBO0FBQ3RDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHpsaWIgZnJvbSBcIm5vZGU6emxpYlwiXG5pbXBvcnQge3Byb21pc2lmeX0gZnJvbSBcIm5vZGU6dXRpbFwiXG5cbmNvbnN0IGJyb3RsaUNvbXByZXNzQXN5bmMgPSBwcm9taXNpZnkoemxpYi5icm90bGlDb21wcmVzcylcbmNvbnN0IGd6aXBBc3luYyA9IHByb21pc2lmeSh6bGliLmd6aXApXG5cbi8qKlxuICogRXhhY3QgbWVkaWEgdHlwZXMgKGJleW9uZCB0aGUgdGV4dC8qLCAqK2pzb24sIGFuZCAqK3htbCBmYW1pbGllcykgdGhhdCBhcmUgd29ydGggY29tcHJlc3NpbmcuXG4gKiBFdmVyeXRoaW5nIGVsc2Ug4oCUIHVua25vd24gYmluYXJ5IHR5cGVzIGFuZCBjb21tb25seSBwcmUtY29tcHJlc3NlZCBtZWRpYSBzdWNoIGFzIGltYWdlcyxcbiAqIHZpZGVvLCBhbmQgYXJjaGl2ZXMg4oCUIGlzIGxlZnQgdW50b3VjaGVkIGJ5IHRoZSBjb25zZXJ2YXRpdmUgYWxsb3dsaXN0LlxuICogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuY29uc3QgQ09NUFJFU1NJQkxFX0VYQUNUX01FRElBX1RZUEVTID0gbmV3IFNldChbXG4gIFwiYXBwbGljYXRpb24vZWNtYXNjcmlwdFwiLFxuICBcImFwcGxpY2F0aW9uL2phdmFzY3JpcHRcIixcbiAgXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gIFwiYXBwbGljYXRpb24veC1qYXZhc2NyaXB0XCIsXG4gIFwiYXBwbGljYXRpb24veG1sXCIsXG4gIFwiaW1hZ2Uvc3ZnK3htbFwiXG5dKVxuXG4vKipcbiAqIFJGQyA5MTEwIMKnMTIuNC4yIHF2YWx1ZSBncmFtbWFyOiBgMGAgb3IgYDFgIHdpdGggYXQgbW9zdCB0aHJlZSBmcmFjdGlvbmFsXG4gKiBkaWdpdHMsIGFuZCBvbmx5IHplcm9zIGFmdGVyIGAxYC5cbiAqIEB0eXBlIHtSZWdFeHB9ICovXG5jb25zdCBRVkFMVUVfUEFUVEVSTiA9IC9eKD86MCg/OlxcLlxcZHsxLDN9KT98MSg/OlxcLjB7MSwzfSk/KSQvdVxuXG4vKipcbiAqIFJ1bnMgcGFyc2UgYWNjZXB0IGVuY29kaW5nLlxuICogQHBhcmFtIHtzdHJpbmd9IGhlYWRlclZhbHVlIC0gQWNjZXB0LUVuY29kaW5nIGhlYWRlciB2YWx1ZS5cbiAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAtIExvd2VyY2FzZWQgY29kaW5nIHRvIHEtdmFsdWUgKDAtMSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUFjY2VwdEVuY29kaW5nKGhlYWRlclZhbHVlKSB7XG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgY29uc3QgY29kaW5ncyA9IG5ldyBNYXAoKVxuXG4gIGZvciAoY29uc3QgcGFydCBvZiBoZWFkZXJWYWx1ZS5zcGxpdChcIixcIikpIHtcbiAgICBjb25zdCBbY29kaW5nVG9rZW4sIC4uLnBhcmFtZXRlcnNdID0gcGFydC5zcGxpdChcIjtcIilcbiAgICBjb25zdCBjb2RpbmcgPSBjb2RpbmdUb2tlbj8udHJpbSgpLnRvTG93ZXJDYXNlKClcblxuICAgIGlmICghY29kaW5nKSBjb250aW51ZVxuXG4gICAgbGV0IHEgPSAxXG5cbiAgICBmb3IgKGNvbnN0IHBhcmFtZXRlciBvZiBwYXJhbWV0ZXJzKSB7XG4gICAgICBjb25zdCBbbmFtZSwgdmFsdWVdID0gcGFyYW1ldGVyLnNwbGl0KFwiPVwiKVxuXG4gICAgICBpZiAobmFtZT8udHJpbSgpLnRvTG93ZXJDYXNlKCkgIT0gXCJxXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHF2YWx1ZSA9IHZhbHVlPy50cmltKCkgfHwgXCJcIlxuXG4gICAgICAvLyBBIG1hbGZvcm1lZCBxLXZhbHVlIChlLmcuIGAuNWAsIGAwMWAsIGAxLjAwMWAsIG1vcmUgdGhhbiB0aHJlZSBmcmFjdGlvbmFsXG4gICAgICAvLyBkaWdpdHMsIG9yIGVtcHR5KSBpcyB0cmVhdGVkIGFzIFwibm90IGFjY2VwdGFibGVcIiAocT0wKSwgcGVyIFJGQyA5MTEwIMKnMTIuNC4yLlxuICAgICAgcSA9IFFWQUxVRV9QQVRURVJOLnRlc3QocXZhbHVlKSA/IE51bWJlcihxdmFsdWUpIDogMFxuICAgIH1cblxuICAgIGNvZGluZ3Muc2V0KGNvZGluZywgcSlcbiAgfVxuXG4gIHJldHVybiBjb2RpbmdzXG59XG5cbi8qKlxuICogTmVnb3RpYXRlcyB0aGUgY29udGVudCBjb2RpbmcgZm9yIGEgcmVzcG9uc2UgZnJvbSB0aGUgQWNjZXB0LUVuY29kaW5nIGhlYWRlci5cbiAqIElkZW50aXR5IHBhcnRpY2lwYXRlcyBpbiB0aGUgc2FtZSBxdWFsaXR5IGNvbXBhcmlzb24gYXMgdGhlIHN1cHBvcnRlZCBjb2RpbmdzOlxuICogYSBoaWdoZXItcSBpZGVudGl0eSBzZWxlY3RzIGlkZW50aXR5LCBhbmQgZXF1YWwtcSB0aWVzIGJyZWFrIGluIHNlcnZlciBvcmRlclxuICogYnIsIGd6aXAsIGlkZW50aXR5LiBJZGVudGl0eSBkZWZhdWx0cyB0byBhY2NlcHRhYmxlIHVubGVzcyBleHBsaWNpdGx5IHJlZnVzZWRcbiAqIHdpdGggYGlkZW50aXR5O3E9MGAgb3IgYSBgKjtxPTBgIHdpbGRjYXJkIHdpdGhvdXQgYSBtb3JlIHNwZWNpZmljIGlkZW50aXR5XG4gKiBlbnRyeSwgYW5kIGFuIGV4cGxpY2l0IGNvZGluZyBlbnRyeSBiZWF0cyB0aGUgd2lsZGNhcmQuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFjY2VwdEVuY29kaW5nIC0gQWNjZXB0LUVuY29kaW5nIGhlYWRlciB2YWx1ZS5cbiAqIEByZXR1cm5zIHt7ZW5jb2Rpbmc6IFwiYnJcIiB8IFwiZ3ppcFwiIHwgXCJpZGVudGl0eVwiLCBpZGVudGl0eUFjY2VwdGFibGU6IGJvb2xlYW59IHwge25vdEFjY2VwdGFibGU6IHRydWV9fSAtIE5lZ290aWF0ZWQgY29kaW5nLCBvciB0aGF0IG5vIGFjY2VwdGFibGUgcmVwcmVzZW50YXRpb24gZXhpc3RzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmVnb3RpYXRlQ29udGVudEVuY29kaW5nKGFjY2VwdEVuY29kaW5nKSB7XG4gIGlmIChhY2NlcHRFbmNvZGluZyA9PT0gdW5kZWZpbmVkIHx8IGFjY2VwdEVuY29kaW5nID09PSBudWxsIHx8IGFjY2VwdEVuY29kaW5nLnRyaW0oKSA9PT0gXCJcIikge1xuICAgIHJldHVybiB7ZW5jb2Rpbmc6IFwiaWRlbnRpdHlcIiwgaWRlbnRpdHlBY2NlcHRhYmxlOiB0cnVlfVxuICB9XG5cbiAgY29uc3QgY29kaW5ncyA9IHBhcnNlQWNjZXB0RW5jb2RpbmcoYWNjZXB0RW5jb2RpbmcpXG4gIGNvbnN0IHdpbGRjYXJkUSA9IGNvZGluZ3MuZ2V0KFwiKlwiKVxuICBjb25zdCBpZGVudGl0eVEgPSBjb2RpbmdzLmdldChcImlkZW50aXR5XCIpID8/IHdpbGRjYXJkUSA/PyAxXG5cbiAgLy8gRGVjbGFyZWQgaW4gc2VydmVyIHByZWZlcmVuY2Ugb3JkZXI7IHRoZSBzdGFibGUgc29ydCBrZWVwcyB0aGlzIG9yZGVyIGZvciB0aWVzLlxuICAvKiogQHR5cGUge0FycmF5PHtjb2Rpbmc6IFwiYnJcIiB8IFwiZ3ppcFwiIHwgXCJpZGVudGl0eVwiLCBxOiBudW1iZXJ9Pn0gKi9cbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICB7Y29kaW5nOiBcImJyXCIsIHE6IGNvZGluZ3MuZ2V0KFwiYnJcIikgPz8gd2lsZGNhcmRRID8/IDB9LFxuICAgIHtjb2Rpbmc6IFwiZ3ppcFwiLCBxOiBjb2RpbmdzLmdldChcImd6aXBcIikgPz8gd2lsZGNhcmRRID8/IDB9LFxuICAgIHtjb2Rpbmc6IFwiaWRlbnRpdHlcIiwgcTogaWRlbnRpdHlRfVxuICBdXG4gIGNvbnN0IHNlbGVjdGVkID0gY2FuZGlkYXRlc1xuICAgIC5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLnEgPiAwKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiLnEgLSBhLnEpWzBdXG5cbiAgaWYgKCFzZWxlY3RlZCkgcmV0dXJuIHtub3RBY2NlcHRhYmxlOiB0cnVlfVxuXG4gIHJldHVybiB7ZW5jb2Rpbmc6IHNlbGVjdGVkLmNvZGluZywgaWRlbnRpdHlBY2NlcHRhYmxlOiBpZGVudGl0eVEgPiAwfVxufVxuXG4vKipcbiAqIFJ1bnMgaXMgY29tcHJlc3NpYmxlIGNvbnRlbnQgdHlwZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZW50VHlwZSAtIENvbnRlbnQtVHlwZSBoZWFkZXIgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBtZWRpYSB0eXBlIGlzIG9uIHRoZSBjb21wcmVzc2libGUgYWxsb3dsaXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNDb21wcmVzc2libGVDb250ZW50VHlwZShjb250ZW50VHlwZSkge1xuICBjb25zdCBtZWRpYVR5cGUgPSBjb250ZW50VHlwZS5zcGxpdChcIjtcIilbMF0/LnRyaW0oKS50b0xvd2VyQ2FzZSgpXG5cbiAgaWYgKCFtZWRpYVR5cGUpIHJldHVybiBmYWxzZVxuXG4gIC8vIFNlcnZlci1zZW50IGV2ZW50cyBhcmUgbG9uZy1saXZlZCBzdHJlYW1zOyBidWZmZXJpbmcgdGhlbSBmb3IgY29tcHJlc3Npb25cbiAgLy8gd291bGQgYnJlYWsgZGVsaXZlcnksIHNvIHRoZXkgYXJlIGV4Y2x1ZGVkIGJlZm9yZSB0aGUgdGV4dHVhbCBhbGxvd2xpc3QuXG4gIGlmIChtZWRpYVR5cGUgPT0gXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiKSByZXR1cm4gZmFsc2VcbiAgaWYgKG1lZGlhVHlwZS5zdGFydHNXaXRoKFwidGV4dC9cIikpIHJldHVybiB0cnVlXG4gIGlmIChtZWRpYVR5cGUuZW5kc1dpdGgoXCIranNvblwiKSB8fCBtZWRpYVR5cGUuZW5kc1dpdGgoXCIreG1sXCIpKSByZXR1cm4gdHJ1ZVxuXG4gIHJldHVybiBDT01QUkVTU0lCTEVfRVhBQ1RfTUVESUFfVFlQRVMuaGFzKG1lZGlhVHlwZSlcbn1cblxuLyoqXG4gKiBNZXJnZXMgQWNjZXB0LUVuY29kaW5nIGludG8gdGhlIHJlc3BvbnNlIFZhcnkgaGVhZGVyIGNhc2UtaW5zZW5zaXRpdmVseSBhbmRcbiAqIHdpdGhvdXQgZHVwbGljYXRlcy4gQW4gZXhpc3RpbmcgYFZhcnk6ICpgIGFscmVhZHkgY292ZXJzIGV2ZXJ5IHJlcXVlc3QgaGVhZGVyXG4gKiBhbmQgaXMgcHJlc2VydmVkIGFzLWlzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHR9IHJlc3BvbnNlIC0gUmVzcG9uc2UgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZGRBY2NlcHRFbmNvZGluZ1RvVmFyeShyZXNwb25zZSkge1xuICBmb3IgKGNvbnN0IGhlYWRlcktleSBpbiByZXNwb25zZS5oZWFkZXJzKSB7XG4gICAgaWYgKGhlYWRlcktleS50b0xvd2VyQ2FzZSgpICE9IFwidmFyeVwiKSBjb250aW51ZVxuXG4gICAgY29uc3QgdmFsdWVzID0gcmVzcG9uc2UuaGVhZGVyc1toZWFkZXJLZXldXG4gICAgY29uc3QgdG9rZW5zID0gdmFsdWVzLmZsYXRNYXAoKHZhbHVlKSA9PiB2YWx1ZS5zcGxpdChcIixcIikubWFwKCh0b2tlbikgPT4gdG9rZW4udHJpbSgpLnRvTG93ZXJDYXNlKCkpKVxuXG4gICAgaWYgKHRva2Vucy5pbmNsdWRlcyhcIipcIikgfHwgdG9rZW5zLmluY2x1ZGVzKFwiYWNjZXB0LWVuY29kaW5nXCIpKSByZXR1cm5cblxuICAgIGlmICh2YWx1ZXMubGVuZ3RoID4gMCkge1xuICAgICAgdmFsdWVzWzBdID0gYCR7dmFsdWVzWzBdfSwgQWNjZXB0LUVuY29kaW5nYFxuICAgIH1cblxuICAgIHJldHVyblxuICB9XG5cbiAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiVmFyeVwiLCBcIkFjY2VwdC1FbmNvZGluZ1wiKVxufVxuXG4vKipcbiAqIE5lZ290aWF0ZXMgYW5kIGFwcGxpZXMgY29tcHJlc3Npb24gdG8gYSBidWZmZXJlZCByZXNwb25zZSBib2R5IGltbWVkaWF0ZWx5IGJlZm9yZVxuICogZnJhbWluZy4gT25seSBzdHJpbmcvVWludDhBcnJheSByZXNwb25zZXMgcmVhY2ggdGhpcyBwb2ludDsgc2VuZEZpbGUgcmVzcG9uc2VzIGFuZFxuICogYm9keWxlc3Mgc3RhdHVzZXMgYXJlIGV4Y2x1ZGVkIGJ5IHRoZSBjYWxsZXIuIFRyYW5zZm9ybWF0aW9uIGlzIHNraXBwZWQgZm9yXG4gKiBDYWNoZS1Db250cm9sIG5vLXRyYW5zZm9ybSwgbm9uLWFsbG93bGlzdGVkIG9yIHByZS1jb21wcmVzc2VkIG1lZGlhIHR5cGVzLFxuICogc2VydmVyLXNlbnQgZXZlbnRzLCBwYXJ0aWFsICgyMDYpIHJlc3BvbnNlcywgcmVxdWVzdHMgd2l0aCBhIFJhbmdlIGhlYWRlcixcbiAqIGNyZWRlbnRpYWxlZCByZXF1ZXN0cyAoQXV0aG9yaXphdGlvbi9Db29raWUgaGVhZGVycyksIHJlc3BvbnNlcyBjYXJyeWluZ1xuICogY3JlZGVudGlhbHMgb3IgdmFsaWRhdG9ycyAoU2V0LUNvb2tpZS9FVGFnL0RpZ2VzdC9Db250ZW50LURpZ2VzdC9Db250ZW50LVJhbmdlXG4gKiBoZWFkZXJzKSwgYW5kIHBlci1yZXNwb25zZSBvcHQtb3V0czsgYSBza2lwcGVkXG4gKiB0cmFuc2Zvcm1hdGlvbiBpcyBzdGlsbCBzZW50IGFzIGlkZW50aXR5IHdoZW4gdGhlIGNsaWVudCBhY2NlcHRzIGlkZW50aXR5LCBhbmRcbiAqIGFuc3dlcmVkIFwibm90LWFjY2VwdGFibGVcIiB3aGVuIGl0IGRvZXMgbm90LiBSZXNwb25zZXMgdGhhdCBhbHJlYWR5IGNhcnJ5IGFuXG4gKiBhcHBsaWNhdGlvbi1zdXBwbGllZCBDb250ZW50LUVuY29kaW5nIGFyZSBwYXNzZWQgdGhyb3VnaCB1bmNoYW5nZWQgYW5kIG5ldmVyXG4gKiBuZWdvdGlhdGUuIFdoZW4gdGhlIGNsaWVudCBmb3JiaWRzIGV2ZXJ5IHJlcHJlc2VudGF0aW9uIChpZGVudGl0eSBhbmQgYWxsXG4gKiBzdXBwb3J0ZWQgY29kaW5ncyksIHRoZSBvdXRjb21lIGlzIFwibm90LWFjY2VwdGFibGVcIi5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gKiBAcGFyYW0ge0J1ZmZlcn0gYXJncy5ib2R5QnVmZmVyIC0gQnVmZmVyZWQgcmVzcG9uc2UgYm9keSBieXRlcyAoVVRGLTggZW5jb2RlZCBmb3Igc3RyaW5nIGJvZGllcykuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEh0dHBDb21wcmVzc2lvbkNvbmZpZ3VyYXRpb259IGFyZ3MuY29tcHJlc3Npb24gLSBOb3JtYWxpemVkIGNvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXNwb25zZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlc3BvbnNlIC0gUmVzcG9uc2UgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx7b3V0Y29tZTogXCJpZGVudGl0eVwifSB8IHtvdXRjb21lOiBcImNvbXByZXNzZWRcIiwgYm9keTogQnVmZmVyfSB8IHtvdXRjb21lOiBcIm5vdC1hY2NlcHRhYmxlXCJ9Pn0gLSBDb21wcmVzc2lvbiBvdXRjb21lLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYXBwbHlSZXNwb25zZUNvbXByZXNzaW9uKHtib2R5QnVmZmVyLCBjb21wcmVzc2lvbiwgcmVxdWVzdCwgcmVzcG9uc2V9KSB7XG4gIGlmICghY29tcHJlc3Npb24uZW5hYmxlZCkgcmV0dXJuIHtvdXRjb21lOiBcImlkZW50aXR5XCJ9XG5cbiAgLy8gQXBwbGljYXRpb24tc3VwcGxpZWQgZW5jb2RpbmdzIHN0YXkgYXBwbGljYXRpb24tb3duZWQ6IHRoZXkgYXJlIHBhc3NlZCB0aHJvdWdoXG4gIC8vIHVuY2hhbmdlZCBhbmQgbmV2ZXIgdGFrZSBwYXJ0IGluIG5lZ290aWF0aW9uIGZhaWx1cmUgaGFuZGxpbmcuXG4gIGlmIChyZXNwb25zZS5nZXRIZWFkZXIoXCJDb250ZW50LUVuY29kaW5nXCIpLmxlbmd0aCA+IDApIHJldHVybiB7b3V0Y29tZTogXCJpZGVudGl0eVwifVxuXG4gIGNvbnN0IG5lZ290aWF0ZWQgPSBuZWdvdGlhdGVDb250ZW50RW5jb2RpbmcocmVxdWVzdC5oZWFkZXIoXCJhY2NlcHQtZW5jb2RpbmdcIikpXG5cbiAgaWYgKFwibm90QWNjZXB0YWJsZVwiIGluIG5lZ290aWF0ZWQpIHJldHVybiB7b3V0Y29tZTogXCJub3QtYWNjZXB0YWJsZVwifVxuXG4gIGNvbnN0IGNhY2hlQ29udHJvbFRva2VucyA9IHJlc3BvbnNlLmdldEhlYWRlcihcIkNhY2hlLUNvbnRyb2xcIilcbiAgICAuZmxhdE1hcCgodmFsdWUpID0+IHZhbHVlLnNwbGl0KFwiLFwiKSlcbiAgICAubWFwKCh0b2tlbikgPT4gdG9rZW4udHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVzcG9uc2UuZ2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIpWzBdXG5cbiAgLy8gQXV0b21hdGljIHNlY3VyaXR5IGV4Y2x1c2lvbnM6IGNyZWRlbnRpYWxlZCByZXF1ZXN0cyAoQXV0aG9yaXphdGlvbi9Db29raWUpIGFuZFxuICAvLyByZXNwb25zZXMgY2FycnlpbmcgY3JlZGVudGlhbHMgKFNldC1Db29raWUpIG9yIHJlcHJlc2VudGF0aW9uIHZhbGlkYXRvcnNcbiAgLy8gKEVUYWcvRGlnZXN0L0NvbnRlbnQtRGlnZXN0KSBhcmUgbmV2ZXIgdHJhbnNmb3JtZWQg4oCUIGNvbXByZXNzaW9uIGNvdWxkIGxlYWtcbiAgLy8gc2VjcmV0LWJlYXJpbmcgY29udGVudCB0aHJvdWdoIGEgY29tcHJlc3Npb24gb3JhY2xlLCBhbmQgdmFsaWRhdG9ycyBzdGF5XG4gIC8vIGFwcGxpY2F0aW9uLW93bmVkIHJhdGhlciB0aGFuIGJlaW5nIHJlY29tcHV0ZWQgZm9yIGVuY29kZWQgdmFyaWFudHMuXG4gIGNvbnN0IHRyYW5zZm9ybWFibGUgPSAhcmVzcG9uc2UuaXNDb21wcmVzc2lvbkRpc2FibGVkKCkgJiZcbiAgICByZXNwb25zZS5nZXRTdGF0dXNDb2RlKCkgIT09IDIwNiAmJlxuICAgICFyZXF1ZXN0LmhlYWRlcihcInJhbmdlXCIpICYmXG4gICAgIXJlcXVlc3QuaGVhZGVyKFwiYXV0aG9yaXphdGlvblwiKSAmJlxuICAgICFyZXF1ZXN0LmhlYWRlcihcImNvb2tpZVwiKSAmJlxuICAgIHJlc3BvbnNlLmdldEhlYWRlcihcIkNvbnRlbnQtUmFuZ2VcIikubGVuZ3RoID09PSAwICYmXG4gICAgcmVzcG9uc2UuZ2V0SGVhZGVyKFwiU2V0LUNvb2tpZVwiKS5sZW5ndGggPT09IDAgJiZcbiAgICByZXNwb25zZS5nZXRIZWFkZXIoXCJFVGFnXCIpLmxlbmd0aCA9PT0gMCAmJlxuICAgIHJlc3BvbnNlLmdldEhlYWRlcihcIkRpZ2VzdFwiKS5sZW5ndGggPT09IDAgJiZcbiAgICByZXNwb25zZS5nZXRIZWFkZXIoXCJDb250ZW50LURpZ2VzdFwiKS5sZW5ndGggPT09IDAgJiZcbiAgICAhY2FjaGVDb250cm9sVG9rZW5zLmluY2x1ZGVzKFwibm8tdHJhbnNmb3JtXCIpICYmXG4gICAgY29udGVudFR5cGUgIT09IHVuZGVmaW5lZCAmJlxuICAgIGlzQ29tcHJlc3NpYmxlQ29udGVudFR5cGUoY29udGVudFR5cGUpXG5cbiAgaWYgKCF0cmFuc2Zvcm1hYmxlKSB7XG4gICAgLy8gQSBza2lwcGVkIHRyYW5zZm9ybWF0aW9uIG1heSBzdGlsbCBnbyBvdXQgYXMgaWRlbnRpdHkgd2hlbiB0aGUgY2xpZW50IGFjY2VwdHNcbiAgICAvLyBpZGVudGl0eTsgd2hlbiBpZGVudGl0eSBpcyBmb3JiaWRkZW4sIG5vIGFjY2VwdGFibGUgcmVwcmVzZW50YXRpb24gY2FuIGJlIHNlbnQuXG4gICAgcmV0dXJuIG5lZ290aWF0ZWQuaWRlbnRpdHlBY2NlcHRhYmxlID8ge291dGNvbWU6IFwiaWRlbnRpdHlcIn0gOiB7b3V0Y29tZTogXCJub3QtYWNjZXB0YWJsZVwifVxuICB9XG5cbiAgLy8gVGhlIHJlcHJlc2VudGF0aW9uIG5vdyBkZXBlbmRzIG9uIHRoZSByZXF1ZXN0J3MgQWNjZXB0LUVuY29kaW5nLCBldmVuIHdoZW4gdGhpc1xuICAvLyBwYXJ0aWN1bGFyIHJlc3BvbnNlIGVuZHMgdXAgaWRlbnRpdHkgKG1pc3NpbmcgaGVhZGVyLCBoaWdoZXItcSBpZGVudGl0eSwgYmVsb3cgdGhyZXNob2xkKS5cbiAgYWRkQWNjZXB0RW5jb2RpbmdUb1ZhcnkocmVzcG9uc2UpXG5cbiAgaWYgKG5lZ290aWF0ZWQuZW5jb2RpbmcgPT0gXCJpZGVudGl0eVwiKSByZXR1cm4ge291dGNvbWU6IFwiaWRlbnRpdHlcIn1cblxuICAvLyBCZWxvdyB0aGUgdGhyZXNob2xkIHRoZSBzbWFsbGVyIGlkZW50aXR5IHJlcHJlc2VudGF0aW9uIGlzIHNlbnQgaW5zdGVhZCDigJQgYnV0IG9ubHlcbiAgLy8gd2hlbiBpZGVudGl0eSBpcyBhY2NlcHRhYmxlOyBhIGNsaWVudCB0aGF0IGZvcmJpZHMgaWRlbnRpdHkgbXVzdCBuZXZlciBiZSBmb3JjZWRcbiAgLy8gb250byBhbiB1bmFjY2VwdGFibGUgcmVwcmVzZW50YXRpb24gYnkgdGhlIHNpemUgY2hlY2suXG4gIGlmIChib2R5QnVmZmVyLmxlbmd0aCA8IGNvbXByZXNzaW9uLnRocmVzaG9sZCAmJiBuZWdvdGlhdGVkLmlkZW50aXR5QWNjZXB0YWJsZSkgcmV0dXJuIHtvdXRjb21lOiBcImlkZW50aXR5XCJ9XG5cbiAgY29uc3QgYm9keSA9IG5lZ290aWF0ZWQuZW5jb2RpbmcgPT0gXCJiclwiXG4gICAgPyBhd2FpdCBicm90bGlDb21wcmVzc0FzeW5jKGJvZHlCdWZmZXIsIHtwYXJhbXM6IHtbemxpYi5jb25zdGFudHMuQlJPVExJX1BBUkFNX1FVQUxJVFldOiBjb21wcmVzc2lvbi5icm90bGlRdWFsaXR5fX0pXG4gICAgOiBhd2FpdCBnemlwQXN5bmMoYm9keUJ1ZmZlciwge2xldmVsOiBjb21wcmVzc2lvbi5nemlwTGV2ZWx9KVxuXG4gIHJlc3BvbnNlLnNldEhlYWRlcihcIkNvbnRlbnQtRW5jb2RpbmdcIiwgbmVnb3RpYXRlZC5lbmNvZGluZylcblxuICByZXR1cm4ge2JvZHksIG91dGNvbWU6IFwiY29tcHJlc3NlZFwifVxufVxuIl19