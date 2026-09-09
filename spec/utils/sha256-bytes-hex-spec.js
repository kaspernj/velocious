// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import sha256BytesHex from "../../src/utils/sha256-bytes-hex.js"
import sha256Hex from "../../src/utils/sha256-hex.js"

describe("SHA-256 browser-safe helpers", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("digests arbitrary bytes and UTF-8 strings with standard SHA-256 vectors", () => {
    expect(sha256BytesHex(Uint8Array.from([0, 127, 128, 255]))).toEqual("89273d2f70b93285bb7ddb4bcee86a5347ca7159352e3cbdd20c23e9d1e507d3")
    expect(sha256Hex("Velocious 🚀")).toEqual("a8123776be14c53dea1069d4174e7ceb664b5fccd50fea7b642e539ccb71edbc")
  })

  it("processes typed-array blocks without iterating or expanding the complete input", () => {
    class NonIterableBytes extends Uint8Array {
      /** @returns {IterableIterator<number>} Byte iterator. */
      [Symbol.iterator]() {
        throw new Error("SHA-256 must not expand the complete input")
      }
    }

    const expectedDigests = new Map([
      [55, "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318"],
      [56, "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a"],
      [63, "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34"],
      [64, "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"],
      [65, "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0"]
    ])

    for (const [length, expectedDigest] of expectedDigests) {
      const input = new NonIterableBytes(length)

      input.fill(97)
      expect(sha256BytesHex(input)).toEqual(expectedDigest)
    }
  })
})
