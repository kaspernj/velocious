// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import sha256BytesHex from "../../src/utils/sha256-bytes-hex.js"
import sha256Hex from "../../src/utils/sha256-hex.js"

describe("SHA-256 browser-safe helpers", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("digests arbitrary bytes and UTF-8 strings with standard SHA-256 vectors", () => {
    expect(sha256BytesHex(Uint8Array.from([0, 127, 128, 255]))).toEqual("89273d2f70b93285bb7ddb4bcee86a5347ca7159352e3cbdd20c23e9d1e507d3")
    expect(sha256Hex("Velocious 🚀")).toEqual("a8123776be14c53dea1069d4174e7ceb664b5fccd50fea7b642e539ccb71edbc")
  })
})
