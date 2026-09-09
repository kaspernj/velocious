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
 * digits (the boundary forms `0.` and `1.` are valid), and only zeros after `1`.
 * @type {RegExp} */
const QVALUE_PATTERN = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u;
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
 * and is preserved as-is. Called by the response sender for every
 * framework-selected representation so the header is identical for every
 * request on the same connection.
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
 * @returns {Promise<{outcome: "identity"} | {outcome: "compressed", body: Buffer} | {outcome: "not-acceptable"}>} - Compression outcome. The caller owns the Vary header and the file/406 representation decisions.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzcG9uc2UtY29tcHJlc3Npb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLWNvbXByZXNzaW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxFQUFDLFNBQVMsRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUVuQyxNQUFNLG1CQUFtQixHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7QUFDMUQsTUFBTSxTQUFTLEdBQUcsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtBQUV0Qzs7Ozt5QkFJeUI7QUFDekIsTUFBTSw4QkFBOEIsR0FBRyxJQUFJLEdBQUcsQ0FBQztJQUM3Qyx3QkFBd0I7SUFDeEIsd0JBQXdCO0lBQ3hCLGtCQUFrQjtJQUNsQiwwQkFBMEI7SUFDMUIsaUJBQWlCO0lBQ2pCLGVBQWU7Q0FDaEIsQ0FBQyxDQUFBO0FBRUY7OztvQkFHb0I7QUFDcEIsTUFBTSxjQUFjLEdBQUcsdUNBQXVDLENBQUE7QUFFOUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxtQkFBbUIsQ0FBQyxXQUFXO0lBQzdDLGtDQUFrQztJQUNsQyxNQUFNLE9BQU8sR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBRXpCLEtBQUssTUFBTSxJQUFJLElBQUksV0FBVyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsR0FBRyxVQUFVLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ3BELE1BQU0sTUFBTSxHQUFHLFdBQVcsRUFBRSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUVoRCxJQUFJLENBQUMsTUFBTTtZQUFFLFNBQVE7UUFFckIsSUFBSSxDQUFD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RUFBQyxDQUFBO0lBRTVHLE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxRQUFRLElBQUksSUFBSTtRQUN0QyxDQUFDLENBQUMsTUFBTSxtQkFBbUIsQ0FBQyxVQUFVLEVBQUUsRUFBQyxNQUFNLEVBQUUsRUFBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsb0JBQW9CLENBQUMsRUFBRSxXQUFXLENBQUMsYUFBYSxFQUFDLEVBQUMsQ0FBQztRQUNySCxDQUFDLENBQUMsTUFBTSxTQUFTLENBQUMsVUFBVSxFQUFFLEVBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxTQUFTLEVBQUMsQ0FBQyxDQUFBO0lBRS9ELFFBQVEsQ0FBQyxTQUFTLENBQUMsa0JBQWtCLEVBQUUsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBRTNELE9BQU8sRUFBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBQyxDQUFBO0FBQ3RDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHpsaWIgZnJvbSBcIm5vZGU6emxpYlwiXG5pbXBvcnQge3Byb21pc2lmeX0gZnJvbSBcIm5vZGU6dXRpbFwiXG5cbmNvbnN0IGJyb3RsaUNvbXByZXNzQXN5bmMgPSBwcm9taXNpZnkoemxpYi5icm90bGlDb21wcmVzcylcbmNvbnN0IGd6aXBBc3luYyA9IHByb21pc2lmeSh6bGliLmd6aXApXG5cbi8qKlxuICogRXhhY3QgbWVkaWEgdHlwZXMgKGJleW9uZCB0aGUgdGV4dC8qLCAqK2pzb24sIGFuZCAqK3htbCBmYW1pbGllcykgdGhhdCBhcmUgd29ydGggY29tcHJlc3NpbmcuXG4gKiBFdmVyeXRoaW5nIGVsc2Ug4oCUIHVua25vd24gYmluYXJ5IHR5cGVzIGFuZCBjb21tb25seSBwcmUtY29tcHJlc3NlZCBtZWRpYSBzdWNoIGFzIGltYWdlcyxcbiAqIHZpZGVvLCBhbmQgYXJjaGl2ZXMg4oCUIGlzIGxlZnQgdW50b3VjaGVkIGJ5IHRoZSBjb25zZXJ2YXRpdmUgYWxsb3dsaXN0LlxuICogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuY29uc3QgQ09NUFJFU1NJQkxFX0VYQUNUX01FRElBX1RZUEVTID0gbmV3IFNldChbXG4gIFwiYXBwbGljYXRpb24vZWNtYXNjcmlwdFwiLFxuICBcImFwcGxpY2F0aW9uL2phdmFzY3JpcHRcIixcbiAgXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gIFwiYXBwbGljYXRpb24veC1qYXZhc2NyaXB0XCIsXG4gIFwiYXBwbGljYXRpb24veG1sXCIsXG4gIFwiaW1hZ2Uvc3ZnK3htbFwiXG5dKVxuXG4vKipcbiAqIFJGQyA5MTEwIMKnMTIuNC4yIHF2YWx1ZSBncmFtbWFyOiBgMGAgb3IgYDFgIHdpdGggYXQgbW9zdCB0aHJlZSBmcmFjdGlvbmFsXG4gKiBkaWdpdHMgKHRoZSBib3VuZGFyeSBmb3JtcyBgMC5gIGFuZCBgMS5gIGFyZSB2YWxpZCksIGFuZCBvbmx5IHplcm9zIGFmdGVyIGAxYC5cbiAqIEB0eXBlIHtSZWdFeHB9ICovXG5jb25zdCBRVkFMVUVfUEFUVEVSTiA9IC9eKD86MCg/OlxcLlxcZHswLDN9KT98MSg/OlxcLjB7MCwzfSk/KSQvdVxuXG4vKipcbiAqIFJ1bnMgcGFyc2UgYWNjZXB0IGVuY29kaW5nLlxuICogQHBhcmFtIHtzdHJpbmd9IGhlYWRlclZhbHVlIC0gQWNjZXB0LUVuY29kaW5nIGhlYWRlciB2YWx1ZS5cbiAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAtIExvd2VyY2FzZWQgY29kaW5nIHRvIHEtdmFsdWUgKDAtMSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUFjY2VwdEVuY29kaW5nKGhlYWRlclZhbHVlKSB7XG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgY29uc3QgY29kaW5ncyA9IG5ldyBNYXAoKVxuXG4gIGZvciAoY29uc3QgcGFydCBvZiBoZWFkZXJWYWx1ZS5zcGxpdChcIixcIikpIHtcbiAgICBjb25zdCBbY29kaW5nVG9rZW4sIC4uLnBhcmFtZXRlcnNdID0gcGFydC5zcGxpdChcIjtcIilcbiAgICBjb25zdCBjb2RpbmcgPSBjb2RpbmdUb2tlbj8udHJpbSgpLnRvTG93ZXJDYXNlKClcblxuICAgIGlmICghY29kaW5nKSBjb250aW51ZVxuXG4gICAgbGV0IHEgPSAxXG5cbiAgICBmb3IgKGNvbnN0IHBhcmFtZXRlciBvZiBwYXJhbWV0ZXJzKSB7XG4gICAgICBjb25zdCBbbmFtZSwgdmFsdWVdID0gcGFyYW1ldGVyLnNwbGl0KFwiPVwiKVxuXG4gICAgICBpZiAobmFtZT8udHJpbSgpLnRvTG93ZXJDYXNlKCkgIT0gXCJxXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHF2YWx1ZSA9IHZhbHVlPy50cmltKCkgfHwgXCJcIlxuXG4gICAgICAvLyBBIG1hbGZvcm1lZCBxLXZhbHVlIChlLmcuIGAuNWAsIGAwMWAsIGAxLjAwMWAsIG1vcmUgdGhhbiB0aHJlZSBmcmFjdGlvbmFsXG4gICAgICAvLyBkaWdpdHMsIG9yIGVtcHR5KSBpcyB0cmVhdGVkIGFzIFwibm90IGFjY2VwdGFibGVcIiAocT0wKSwgcGVyIFJGQyA5MTEwIMKnMTIuNC4yLlxuICAgICAgcSA9IFFWQUxVRV9QQVRURVJOLnRlc3QocXZhbHVlKSA/IE51bWJlcihxdmFsdWUpIDogMFxuICAgIH1cblxuICAgIGNvZGluZ3Muc2V0KGNvZGluZywgcSlcbiAgfVxuXG4gIHJldHVybiBjb2RpbmdzXG59XG5cbi8qKlxuICogTmVnb3RpYXRlcyB0aGUgY29udGVudCBjb2RpbmcgZm9yIGEgcmVzcG9uc2UgZnJvbSB0aGUgQWNjZXB0LUVuY29kaW5nIGhlYWRlci5cbiAqIElkZW50aXR5IHBhcnRpY2lwYXRlcyBpbiB0aGUgc2FtZSBxdWFsaXR5IGNvbXBhcmlzb24gYXMgdGhlIHN1cHBvcnRlZCBjb2RpbmdzOlxuICogYSBoaWdoZXItcSBpZGVudGl0eSBzZWxlY3RzIGlkZW50aXR5LCBhbmQgZXF1YWwtcSB0aWVzIGJyZWFrIGluIHNlcnZlciBvcmRlclxuICogYnIsIGd6aXAsIGlkZW50aXR5LiBJZGVudGl0eSBkZWZhdWx0cyB0byBhY2NlcHRhYmxlIHVubGVzcyBleHBsaWNpdGx5IHJlZnVzZWRcbiAqIHdpdGggYGlkZW50aXR5O3E9MGAgb3IgYSBgKjtxPTBgIHdpbGRjYXJkIHdpdGhvdXQgYSBtb3JlIHNwZWNpZmljIGlkZW50aXR5XG4gKiBlbnRyeSwgYW5kIGFuIGV4cGxpY2l0IGNvZGluZyBlbnRyeSBiZWF0cyB0aGUgd2lsZGNhcmQuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFjY2VwdEVuY29kaW5nIC0gQWNjZXB0LUVuY29kaW5nIGhlYWRlciB2YWx1ZS5cbiAqIEByZXR1cm5zIHt7ZW5jb2Rpbmc6IFwiYnJcIiB8IFwiZ3ppcFwiIHwgXCJpZGVudGl0eVwiLCBpZGVudGl0eUFjY2VwdGFibGU6IGJvb2xlYW59IHwge25vdEFjY2VwdGFibGU6IHRydWV9fSAtIE5lZ290aWF0ZWQgY29kaW5nLCBvciB0aGF0IG5vIGFjY2VwdGFibGUgcmVwcmVzZW50YXRpb24gZXhpc3RzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmVnb3RpYXRlQ29udGVudEVuY29kaW5nKGFjY2VwdEVuY29kaW5nKSB7XG4gIGlmIChhY2NlcHRFbmNvZGluZyA9PT0gdW5kZWZpbmVkIHx8IGFjY2VwdEVuY29kaW5nID09PSBudWxsIHx8IGFjY2VwdEVuY29kaW5nLnRyaW0oKSA9PT0gXCJcIikge1xuICAgIHJldHVybiB7ZW5jb2Rpbmc6IFwiaWRlbnRpdHlcIiwgaWRlbnRpdHlBY2NlcHRhYmxlOiB0cnVlfVxuICB9XG5cbiAgY29uc3QgY29kaW5ncyA9IHBhcnNlQWNjZXB0RW5jb2RpbmcoYWNjZXB0RW5jb2RpbmcpXG4gIGNvbnN0IHdpbGRjYXJkUSA9IGNvZGluZ3MuZ2V0KFwiKlwiKVxuICBjb25zdCBpZGVudGl0eVEgPSBjb2RpbmdzLmdldChcImlkZW50aXR5XCIpID8/IHdpbGRjYXJkUSA/PyAxXG5cbiAgLy8gRGVjbGFyZWQgaW4gc2VydmVyIHByZWZlcmVuY2Ugb3JkZXI7IHRoZSBzdGFibGUgc29ydCBrZWVwcyB0aGlzIG9yZGVyIGZvciB0aWVzLlxuICAvKiogQHR5cGUge0FycmF5PHtjb2Rpbmc6IFwiYnJcIiB8IFwiZ3ppcFwiIHwgXCJpZGVudGl0eVwiLCBxOiBudW1iZXJ9Pn0gKi9cbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICB7Y29kaW5nOiBcImJyXCIsIHE6IGNvZGluZ3MuZ2V0KFwiYnJcIikgPz8gd2lsZGNhcmRRID8/IDB9LFxuICAgIHtjb2Rpbmc6IFwiZ3ppcFwiLCBxOiBjb2RpbmdzLmdldChcImd6aXBcIikgPz8gd2lsZGNhcmRRID8/IDB9LFxuICAgIHtjb2Rpbmc6IFwiaWRlbnRpdHlcIiwgcTogaWRlbnRpdHlRfVxuICBdXG4gIGNvbnN0IHNlbGVjdGVkID0gY2FuZGlkYXRlc1xuICAgIC5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLnEgPiAwKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiLnEgLSBhLnEpWzBdXG5cbiAgaWYgKCFzZWxlY3RlZCkgcmV0dXJuIHtub3RBY2NlcHRhYmxlOiB0cnVlfVxuXG4gIHJldHVybiB7ZW5jb2Rpbmc6IHNlbGVjdGVkLmNvZGluZywgaWRlbnRpdHlBY2NlcHRhYmxlOiBpZGVudGl0eVEgPiAwfVxufVxuXG4vKipcbiAqIFJ1bnMgaXMgY29tcHJlc3NpYmxlIGNvbnRlbnQgdHlwZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZW50VHlwZSAtIENvbnRlbnQtVHlwZSBoZWFkZXIgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBtZWRpYSB0eXBlIGlzIG9uIHRoZSBjb21wcmVzc2libGUgYWxsb3dsaXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNDb21wcmVzc2libGVDb250ZW50VHlwZShjb250ZW50VHlwZSkge1xuICBjb25zdCBtZWRpYVR5cGUgPSBjb250ZW50VHlwZS5zcGxpdChcIjtcIilbMF0/LnRyaW0oKS50b0xvd2VyQ2FzZSgpXG5cbiAgaWYgKCFtZWRpYVR5cGUpIHJldHVybiBmYWxzZVxuXG4gIC8vIFNlcnZlci1zZW50IGV2ZW50cyBhcmUgbG9uZy1saXZlZCBzdHJlYW1zOyBidWZmZXJpbmcgdGhlbSBmb3IgY29tcHJlc3Npb25cbiAgLy8gd291bGQgYnJlYWsgZGVsaXZlcnksIHNvIHRoZXkgYXJlIGV4Y2x1ZGVkIGJlZm9yZSB0aGUgdGV4dHVhbCBhbGxvd2xpc3QuXG4gIGlmIChtZWRpYVR5cGUgPT0gXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiKSByZXR1cm4gZmFsc2VcbiAgaWYgKG1lZGlhVHlwZS5zdGFydHNXaXRoKFwidGV4dC9cIikpIHJldHVybiB0cnVlXG4gIGlmIChtZWRpYVR5cGUuZW5kc1dpdGgoXCIranNvblwiKSB8fCBtZWRpYVR5cGUuZW5kc1dpdGgoXCIreG1sXCIpKSByZXR1cm4gdHJ1ZVxuXG4gIHJldHVybiBDT01QUkVTU0lCTEVfRVhBQ1RfTUVESUFfVFlQRVMuaGFzKG1lZGlhVHlwZSlcbn1cblxuLyoqXG4gKiBNZXJnZXMgQWNjZXB0LUVuY29kaW5nIGludG8gdGhlIHJlc3BvbnNlIFZhcnkgaGVhZGVyIGNhc2UtaW5zZW5zaXRpdmVseSBhbmRcbiAqIHdpdGhvdXQgZHVwbGljYXRlcy4gQW4gZXhpc3RpbmcgYFZhcnk6ICpgIGFscmVhZHkgY292ZXJzIGV2ZXJ5IHJlcXVlc3QgaGVhZGVyXG4gKiBhbmQgaXMgcHJlc2VydmVkIGFzLWlzLiBDYWxsZWQgYnkgdGhlIHJlc3BvbnNlIHNlbmRlciBmb3IgZXZlcnlcbiAqIGZyYW1ld29yay1zZWxlY3RlZCByZXByZXNlbnRhdGlvbiBzbyB0aGUgaGVhZGVyIGlzIGlkZW50aWNhbCBmb3IgZXZlcnlcbiAqIHJlcXVlc3Qgb24gdGhlIHNhbWUgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXNwb25zZS5qc1wiKS5kZWZhdWx0fSByZXNwb25zZSAtIFJlc3BvbnNlIGluc3RhbmNlLlxuICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYWRkQWNjZXB0RW5jb2RpbmdUb1ZhcnkocmVzcG9uc2UpIHtcbiAgZm9yIChjb25zdCBoZWFkZXJLZXkgaW4gcmVzcG9uc2UuaGVhZGVycykge1xuICAgIGlmIChoZWFkZXJLZXkudG9Mb3dlckNhc2UoKSAhPSBcInZhcnlcIikgY29udGludWVcblxuICAgIGNvbnN0IHZhbHVlcyA9IHJlc3BvbnNlLmhlYWRlcnNbaGVhZGVyS2V5XVxuICAgIGNvbnN0IHRva2VucyA9IHZhbHVlcy5mbGF0TWFwKCh2YWx1ZSkgPT4gdmFsdWUuc3BsaXQoXCIsXCIpLm1hcCgodG9rZW4pID0+IHRva2VuLnRyaW0oKS50b0xvd2VyQ2FzZSgpKSlcblxuICAgIGlmICh0b2tlbnMuaW5jbHVkZXMoXCIqXCIpIHx8IHRva2Vucy5pbmNsdWRlcyhcImFjY2VwdC1lbmNvZGluZ1wiKSkgcmV0dXJuXG5cbiAgICBpZiAodmFsdWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHZhbHVlc1swXSA9IGAke3ZhbHVlc1swXX0sIEFjY2VwdC1FbmNvZGluZ2BcbiAgICB9XG5cbiAgICByZXR1cm5cbiAgfVxuXG4gIHJlc3BvbnNlLnNldEhlYWRlcihcIlZhcnlcIiwgXCJBY2NlcHQtRW5jb2RpbmdcIilcbn1cblxuLyoqXG4gKiBOZWdvdGlhdGVzIGFuZCBhcHBsaWVzIGNvbXByZXNzaW9uIHRvIGEgYnVmZmVyZWQgcmVzcG9uc2UgYm9keSBpbW1lZGlhdGVseSBiZWZvcmVcbiAqIGZyYW1pbmcuIE9ubHkgc3RyaW5nL1VpbnQ4QXJyYXkgcmVzcG9uc2VzIHJlYWNoIHRoaXMgcG9pbnQ7IHNlbmRGaWxlIHJlc3BvbnNlcyBhbmRcbiAqIGJvZHlsZXNzIHN0YXR1c2VzIGFyZSBleGNsdWRlZCBieSB0aGUgY2FsbGVyLiBUcmFuc2Zvcm1hdGlvbiBpcyBza2lwcGVkIGZvclxuICogQ2FjaGUtQ29udHJvbCBuby10cmFuc2Zvcm0sIG5vbi1hbGxvd2xpc3RlZCBvciBwcmUtY29tcHJlc3NlZCBtZWRpYSB0eXBlcyxcbiAqIHNlcnZlci1zZW50IGV2ZW50cywgcGFydGlhbCAoMjA2KSByZXNwb25zZXMsIHJlcXVlc3RzIHdpdGggYSBSYW5nZSBoZWFkZXIsXG4gKiBjcmVkZW50aWFsZWQgcmVxdWVzdHMgKEF1dGhvcml6YXRpb24vQ29va2llIGhlYWRlcnMpLCByZXNwb25zZXMgY2FycnlpbmdcbiAqIGNyZWRlbnRpYWxzIG9yIHZhbGlkYXRvcnMgKFNldC1Db29raWUvRVRhZy9EaWdlc3QvQ29udGVudC1EaWdlc3QvQ29udGVudC1SYW5nZVxuICogaGVhZGVycyksIGFuZCBwZXItcmVzcG9uc2Ugb3B0LW91dHM7IGEgc2tpcHBlZFxuICogdHJhbnNmb3JtYXRpb24gaXMgc3RpbGwgc2VudCBhcyBpZGVudGl0eSB3aGVuIHRoZSBjbGllbnQgYWNjZXB0cyBpZGVudGl0eSwgYW5kXG4gKiBhbnN3ZXJlZCBcIm5vdC1hY2NlcHRhYmxlXCIgd2hlbiBpdCBkb2VzIG5vdC4gUmVzcG9uc2VzIHRoYXQgYWxyZWFkeSBjYXJyeSBhblxuICogYXBwbGljYXRpb24tc3VwcGxpZWQgQ29udGVudC1FbmNvZGluZyBhcmUgcGFzc2VkIHRocm91Z2ggdW5jaGFuZ2VkIGFuZCBuZXZlclxuICogbmVnb3RpYXRlLiBXaGVuIHRoZSBjbGllbnQgZm9yYmlkcyBldmVyeSByZXByZXNlbnRhdGlvbiAoaWRlbnRpdHkgYW5kIGFsbFxuICogc3VwcG9ydGVkIGNvZGluZ3MpLCB0aGUgb3V0Y29tZSBpcyBcIm5vdC1hY2NlcHRhYmxlXCIuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICogQHBhcmFtIHtCdWZmZXJ9IGFyZ3MuYm9keUJ1ZmZlciAtIEJ1ZmZlcmVkIHJlc3BvbnNlIGJvZHkgYnl0ZXMgKFVURi04IGVuY29kZWQgZm9yIHN0cmluZyBib2RpZXMpLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRIdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9ufSBhcmdzLmNvbXByZXNzaW9uIC0gTm9ybWFsaXplZCBjb21wcmVzc2lvbiBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdH0gYXJncy5yZXF1ZXN0IC0gUmVxdWVzdCBvYmplY3QuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gYXJncy5yZXNwb25zZSAtIFJlc3BvbnNlIGluc3RhbmNlLlxuICogQHJldHVybnMge1Byb21pc2U8e291dGNvbWU6IFwiaWRlbnRpdHlcIn0gfCB7b3V0Y29tZTogXCJjb21wcmVzc2VkXCIsIGJvZHk6IEJ1ZmZlcn0gfCB7b3V0Y29tZTogXCJub3QtYWNjZXB0YWJsZVwifT59IC0gQ29tcHJlc3Npb24gb3V0Y29tZS4gVGhlIGNhbGxlciBvd25zIHRoZSBWYXJ5IGhlYWRlciBhbmQgdGhlIGZpbGUvNDA2IHJlcHJlc2VudGF0aW9uIGRlY2lzaW9ucy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFwcGx5UmVzcG9uc2VDb21wcmVzc2lvbih7Ym9keUJ1ZmZlciwgY29tcHJlc3Npb24sIHJlcXVlc3QsIHJlc3BvbnNlfSkge1xuICBpZiAoIWNvbXByZXNzaW9uLmVuYWJsZWQpIHJldHVybiB7b3V0Y29tZTogXCJpZGVudGl0eVwifVxuXG4gIC8vIEFwcGxpY2F0aW9uLXN1cHBsaWVkIGVuY29kaW5ncyBzdGF5IGFwcGxpY2F0aW9uLW93bmVkOiB0aGV5IGFyZSBwYXNzZWQgdGhyb3VnaFxuICAvLyB1bmNoYW5nZWQgYW5kIG5ldmVyIHRha2UgcGFydCBpbiBuZWdvdGlhdGlvbiBmYWlsdXJlIGhhbmRsaW5nLlxuICBpZiAocmVzcG9uc2UuZ2V0SGVhZGVyKFwiQ29udGVudC1FbmNvZGluZ1wiKS5sZW5ndGggPiAwKSByZXR1cm4ge291dGNvbWU6IFwiaWRlbnRpdHlcIn1cblxuICBjb25zdCBuZWdvdGlhdGVkID0gbmVnb3RpYXRlQ29udGVudEVuY29kaW5nKHJlcXVlc3QuaGVhZGVyKFwiYWNjZXB0LWVuY29kaW5nXCIpKVxuXG4gIGlmIChcIm5vdEFjY2VwdGFibGVcIiBpbiBuZWdvdGlhdGVkKSByZXR1cm4ge291dGNvbWU6IFwibm90LWFjY2VwdGFibGVcIn1cblxuICBjb25zdCBjYWNoZUNvbnRyb2xUb2tlbnMgPSByZXNwb25zZS5nZXRIZWFkZXIoXCJDYWNoZS1Db250cm9sXCIpXG4gICAgLmZsYXRNYXAoKHZhbHVlKSA9PiB2YWx1ZS5zcGxpdChcIixcIikpXG4gICAgLm1hcCgodG9rZW4pID0+IHRva2VuLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICBjb25zdCBjb250ZW50VHlwZSA9IHJlc3BvbnNlLmdldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiKVswXVxuXG4gIC8vIEF1dG9tYXRpYyBzZWN1cml0eSBleGNsdXNpb25zOiBjcmVkZW50aWFsZWQgcmVxdWVzdHMgKEF1dGhvcml6YXRpb24vQ29va2llKSBhbmRcbiAgLy8gcmVzcG9uc2VzIGNhcnJ5aW5nIGNyZWRlbnRpYWxzIChTZXQtQ29va2llKSBvciByZXByZXNlbnRhdGlvbiB2YWxpZGF0b3JzXG4gIC8vIChFVGFnL0RpZ2VzdC9Db250ZW50LURpZ2VzdCkgYXJlIG5ldmVyIHRyYW5zZm9ybWVkIOKAlCBjb21wcmVzc2lvbiBjb3VsZCBsZWFrXG4gIC8vIHNlY3JldC1iZWFyaW5nIGNvbnRlbnQgdGhyb3VnaCBhIGNvbXByZXNzaW9uIG9yYWNsZSwgYW5kIHZhbGlkYXRvcnMgc3RheVxuICAvLyBhcHBsaWNhdGlvbi1vd25lZCByYXRoZXIgdGhhbiBiZWluZyByZWNvbXB1dGVkIGZvciBlbmNvZGVkIHZhcmlhbnRzLlxuICBjb25zdCB0cmFuc2Zvcm1hYmxlID0gIXJlc3BvbnNlLmlzQ29tcHJlc3Npb25EaXNhYmxlZCgpICYmXG4gICAgcmVzcG9uc2UuZ2V0U3RhdHVzQ29kZSgpICE9PSAyMDYgJiZcbiAgICAhcmVxdWVzdC5oZWFkZXIoXCJyYW5nZVwiKSAmJlxuICAgICFyZXF1ZXN0LmhlYWRlcihcImF1dGhvcml6YXRpb25cIikgJiZcbiAgICAhcmVxdWVzdC5oZWFkZXIoXCJjb29raWVcIikgJiZcbiAgICByZXNwb25zZS5nZXRIZWFkZXIoXCJDb250ZW50LVJhbmdlXCIpLmxlbmd0aCA9PT0gMCAmJlxuICAgIHJlc3BvbnNlLmdldEhlYWRlcihcIlNldC1Db29raWVcIikubGVuZ3RoID09PSAwICYmXG4gICAgcmVzcG9uc2UuZ2V0SGVhZGVyKFwiRVRhZ1wiKS5sZW5ndGggPT09IDAgJiZcbiAgICByZXNwb25zZS5nZXRIZWFkZXIoXCJEaWdlc3RcIikubGVuZ3RoID09PSAwICYmXG4gICAgcmVzcG9uc2UuZ2V0SGVhZGVyKFwiQ29udGVudC1EaWdlc3RcIikubGVuZ3RoID09PSAwICYmXG4gICAgIWNhY2hlQ29udHJvbFRva2Vucy5pbmNsdWRlcyhcIm5vLXRyYW5zZm9ybVwiKSAmJlxuICAgIGNvbnRlbnRUeXBlICE9PSB1bmRlZmluZWQgJiZcbiAgICBpc0NvbXByZXNzaWJsZUNvbnRlbnRUeXBlKGNvbnRlbnRUeXBlKVxuXG4gIGlmICghdHJhbnNmb3JtYWJsZSkge1xuICAgIC8vIEEgc2tpcHBlZCB0cmFuc2Zvcm1hdGlvbiBtYXkgc3RpbGwgZ28gb3V0IGFzIGlkZW50aXR5IHdoZW4gdGhlIGNsaWVudCBhY2NlcHRzXG4gICAgLy8gaWRlbnRpdHk7IHdoZW4gaWRlbnRpdHkgaXMgZm9yYmlkZGVuLCBubyBhY2NlcHRhYmxlIHJlcHJlc2VudGF0aW9uIGNhbiBiZSBzZW50LlxuICAgIHJldHVybiBuZWdvdGlhdGVkLmlkZW50aXR5QWNjZXB0YWJsZSA/IHtvdXRjb21lOiBcImlkZW50aXR5XCJ9IDoge291dGNvbWU6IFwibm90LWFjY2VwdGFibGVcIn1cbiAgfVxuXG4gIGlmIChuZWdvdGlhdGVkLmVuY29kaW5nID09IFwiaWRlbnRpdHlcIikgcmV0dXJuIHtvdXRjb21lOiBcImlkZW50aXR5XCJ9XG5cbiAgLy8gQmVsb3cgdGhlIHRocmVzaG9sZCB0aGUgc21hbGxlciBpZGVudGl0eSByZXByZXNlbnRhdGlvbiBpcyBzZW50IGluc3RlYWQg4oCUIGJ1dCBvbmx5XG4gIC8vIHdoZW4gaWRlbnRpdHkgaXMgYWNjZXB0YWJsZTsgYSBjbGllbnQgdGhhdCBmb3JiaWRzIGlkZW50aXR5IG11c3QgbmV2ZXIgYmUgZm9yY2VkXG4gIC8vIG9udG8gYW4gdW5hY2NlcHRhYmxlIHJlcHJlc2VudGF0aW9uIGJ5IHRoZSBzaXplIGNoZWNrLlxuICBpZiAoYm9keUJ1ZmZlci5sZW5ndGggPCBjb21wcmVzc2lvbi50aHJlc2hvbGQgJiYgbmVnb3RpYXRlZC5pZGVudGl0eUFjY2VwdGFibGUpIHJldHVybiB7b3V0Y29tZTogXCJpZGVudGl0eVwifVxuXG4gIGNvbnN0IGJvZHkgPSBuZWdvdGlhdGVkLmVuY29kaW5nID09IFwiYnJcIlxuICAgID8gYXdhaXQgYnJvdGxpQ29tcHJlc3NBc3luYyhib2R5QnVmZmVyLCB7cGFyYW1zOiB7W3psaWIuY29uc3RhbnRzLkJST1RMSV9QQVJBTV9RVUFMSVRZXTogY29tcHJlc3Npb24uYnJvdGxpUXVhbGl0eX19KVxuICAgIDogYXdhaXQgZ3ppcEFzeW5jKGJvZHlCdWZmZXIsIHtsZXZlbDogY29tcHJlc3Npb24uZ3ppcExldmVsfSlcblxuICByZXNwb25zZS5zZXRIZWFkZXIoXCJDb250ZW50LUVuY29kaW5nXCIsIG5lZ290aWF0ZWQuZW5jb2RpbmcpXG5cbiAgcmV0dXJuIHtib2R5LCBvdXRjb21lOiBcImNvbXByZXNzZWRcIn1cbn1cbiJdfQ==