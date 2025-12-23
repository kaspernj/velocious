// @ts-check

import fs from "fs/promises"
import path from "path"
import {describe, expect, it} from "../../src/testing/test.js"
import fetch, {File, FormData} from "node-fetch"

import Dummy from "../dummy/index.js"

const SMALL_IMAGE_BUFFER = await fs.readFile(new URL("../fixtures/screenshot.png", import.meta.url))
const LARGE_IMAGE_BUFFER = await fs.readFile(new URL("../fixtures/Cat_2.9mb.jpg", import.meta.url))

describe("HttpServer - upload", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  it("keeps small uploads in memory and saves them", async () => {
    await Dummy.run(async () => {
      let savedPath

      try {
        const body = new FormData()

        body.append("image", new File([new Uint8Array(SMALL_IMAGE_BUFFER)], "tiny-upload.png", {type: "image/png"}))

        const response = await fetch(
          "http://localhost:3006/upload",
          {
            body,
            method: "POST"
          }
        )
        const data = /** @type {Record<string, any>} */ (await response.json())

        expect(data.status).toEqual("success")
        savedPath = data.upload.destinationPath
        expect(data.upload.className).toEqual("MemoryUploadedFile")
        expect(data.upload.storageType).toEqual("memory")
        expect(data.upload.size).toEqual(SMALL_IMAGE_BUFFER.length)
        expect(data.upload.savedSize).toEqual(SMALL_IMAGE_BUFFER.length)
        expect(data.upload.filename).toEqual("tiny-upload.png")
        expect(data.upload.fieldName).toEqual("image")

        const savedContent = await fs.readFile(savedPath)

        expect(savedContent.equals(SMALL_IMAGE_BUFFER)).toEqual(true)
      } finally {
        if (savedPath) await fs.rm(savedPath, {force: true})
      }
    })
  })

  it("stores larger uploads in a temporary file and saves them", async () => {
    await Dummy.run(async () => {
      const largeBuffer = LARGE_IMAGE_BUFFER
      let savedPath

      try {
        const body = new FormData()

        body.append("image", new File([new Uint8Array(largeBuffer)], "large-upload.png", {type: "image/jpeg"}))

        const response = await fetch(
          "http://localhost:3006/upload",
          {
            body,
            method: "POST"
          }
        )
        const data = /** @type {Record<string, any>} */ (await response.json())

        expect(data.status).toEqual("success")
        savedPath = data.upload.destinationPath
        expect(data.upload.className).toEqual("TemporaryUploadedFile")
        expect(data.upload.storageType).toEqual("temporary")
        expect(data.upload.size).toEqual(largeBuffer.length)
        expect(data.upload.savedSize).toEqual(largeBuffer.length)
        expect(data.upload.filename).toEqual("large-upload.png")
        expect(data.upload.fieldName).toEqual("image")

        if (data.upload.temporaryPath) {
          const tempContent = await fs.readFile(data.upload.temporaryPath)

          expect(tempContent.equals(largeBuffer)).toEqual(true)

          await fs.rm(data.upload.temporaryPath, {force: true})
          await fs.rm(path.dirname(data.upload.temporaryPath), {force: true, recursive: true})
        }

        const savedContent = await fs.readFile(savedPath)

        expect(savedContent.equals(largeBuffer)).toEqual(true)
      } finally {
        if (savedPath) await fs.rm(savedPath, {force: true})
      }
    })
  })
})
