// @ts-check

/**
 * Resolves dummy-app request body handling used by the raw HTTP integration fixtures.
 * @param {import("../../../../src/configuration-types.js").HttpRequestBodyPolicyResolverArgs} args - Parsed request head.
 * @returns {import("../../../../src/configuration-types.js").HttpRequestBodyPolicy | undefined} - Dummy request policy.
 */
export default function requestBodyPolicyResolver({httpMethod, path}) {
  if (httpMethod === "POST" && path.split("?")[0] === "/raw-body") {
    return {maxRequestBodyBytes: 32, mode: "raw"}
  }
}
