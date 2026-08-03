// @ts-check

import fs from "node:fs/promises"
import {describe, expect, it} from "../../src/testing/test.js"
import {buildConfiguration} from "../helpers/http-response-compression-test-helper.js"

describe("http server - response compression configuration", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("resolves to the documented enabled defaults when compression is not configured", () => {
    const configuration = buildConfiguration()

    expect(configuration.getHttpServerCompression()).toEqual({
      enabled: true,
      threshold: 1024,
      brotliQuality: 4,
      gzipLevel: 6
    })
  })

  it("treats an explicit false as disabled", () => {
    const configuration = buildConfiguration({compression: false})

    expect(configuration.getHttpServerCompression()).toEqual({
      enabled: false,
      threshold: 1024,
      brotliQuality: 4,
      gzipLevel: 6
    })
  })

  it("disables compression when the object form sets enabled: false", () => {
    const configuration = buildConfiguration({compression: {enabled: false}})

    expect(configuration.getHttpServerCompression()).toEqual({
      enabled: false,
      threshold: 1024,
      brotliQuality: 4,
      gzipLevel: 6
    })
  })

  it("keeps validated overrides when the object form disables compression", () => {
    const configuration = buildConfiguration({compression: {enabled: false, threshold: 2048}})

    expect(configuration.getHttpServerCompression()).toEqual({
      enabled: false,
      threshold: 2048,
      brotliQuality: 4,
      gzipLevel: 6
    })
  })

  it("rejects a non-boolean enabled flag in the object form", async () => {
    // Intentionally invalid input for validation coverage.
    const compression = /** @type {import("../../src/configuration-types.js").HttpCompressionConfiguration} */ (/** @type {unknown} */ ({enabled: "no"}))

    await expect(() => buildConfiguration({compression})).toThrow(/httpServer\.compression\.enabled/u)
  })

  it("enables compression with documented defaults when configured as true", () => {
    const configuration = buildConfiguration({compression: true})

    expect(configuration.getHttpServerCompression()).toEqual({
      enabled: true,
      threshold: 1024,
      brotliQuality: 4,
      gzipLevel: 6
    })
  })

  it("normalizes an object configuration with custom values", () => {
    const configuration = buildConfiguration({compression: {threshold: 2048, brotliQuality: 8, gzipLevel: 9}})

    expect(configuration.getHttpServerCompression()).toEqual({
      enabled: true,
      threshold: 2048,
      brotliQuality: 8,
      gzipLevel: 9
    })
  })

  it("fills undocumented object values with the documented defaults", () => {
    const configuration = buildConfiguration({compression: {threshold: 512}})

    expect(configuration.getHttpServerCompression()).toEqual({
      enabled: true,
      threshold: 512,
      brotliQuality: 4,
      gzipLevel: 6
    })
  })

  it("rejects a non-boolean non-object compression value", async () => {
    // Intentionally invalid input for validation coverage.
    const compression = /** @type {boolean} */ (/** @type {unknown} */ ("yes"))

    await expect(() => buildConfiguration({compression})).toThrow(/httpServer\.compression/u)
  })

  it("rejects a null compression value", async () => {
    // Intentionally invalid input for validation coverage.
    const compression = /** @type {boolean} */ (/** @type {unknown} */ (null))

    await expect(() => buildConfiguration({compression})).toThrow(/httpServer\.compression/u)
  })

  it("rejects unknown compression keys", async () => {
    // Intentionally invalid input for validation coverage.
    const compression = /** @type {import("../../src/configuration-types.js").HttpCompressionConfiguration} */ (/** @type {unknown} */ ({level: 5}))

    await expect(() => buildConfiguration({compression})).toThrow(/unknown keys: level/u)
  })

  it("rejects a threshold that is not a positive safe integer", async () => {
    await expect(() => buildConfiguration({compression: {threshold: 0}})).toThrow(/threshold/u)
    await expect(() => buildConfiguration({compression: {threshold: 1.5}})).toThrow(/threshold/u)
    await expect(() => buildConfiguration({compression: {threshold: -10}})).toThrow(/threshold/u)
  })

  it("rejects a Brotli quality outside 0-11", async () => {
    await expect(() => buildConfiguration({compression: {brotliQuality: 12}})).toThrow(/brotliQuality/u)
    await expect(() => buildConfiguration({compression: {brotliQuality: -1}})).toThrow(/brotliQuality/u)
    await expect(() => buildConfiguration({compression: {brotliQuality: 4.5}})).toThrow(/brotliQuality/u)
  })

  it("rejects a gzip level outside 0-9", async () => {
    await expect(() => buildConfiguration({compression: {gzipLevel: 10}})).toThrow(/gzipLevel/u)
    await expect(() => buildConfiguration({compression: {gzipLevel: -1}})).toThrow(/gzipLevel/u)
  })

  it("uses no synchronous node:zlib APIs in the compression implementation", async () => {
    const source = await fs.readFile(new URL("../../src/http-server/client/response-compression.js", import.meta.url), "utf8")
    const synchronousZlibApis = /\b(gzipSync|gunzipSync|brotliCompressSync|brotliDecompressSync|deflateSync|deflateRawSync|inflateSync|inflateRawSync|unzipSync)\b/u

    expect(synchronousZlibApis.test(source)).toBeFalse()
  })
})
