import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import {describe, expect, it, beforeAll, afterAll} from "../../../src/testing/test.js"
import Response from "../../../src/http-server/client/response.js"
import serveFile from "../../../src/http-server/client/serve-file.js"

const stubConfiguration = /** @type {any} */ ({
  getHttpServerMaxBufferedResponseBodyBytes: () => undefined
})

/**
 * @returns {import("../../../src/http-server/client/response.js").default}
 */
function makeResponse() {
  return new Response({configuration: stubConfiguration})
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @param {string} content
 */
async function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath)
  await fs.mkdir(path.dirname(filePath), {recursive: true})
  await fs.writeFile(filePath, content, "utf8")
}

describe("serveFile", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  /** @type {string} */
  let root

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-serve-file-"))
  })

  afterAll(async () => {
    await fs.rm(root, {recursive: true, force: true})
  })

  it("serves an existing file with the requested content type and caching policy", async () => {
    await writeFile(root, "hello.txt", "hello world")

    const response = makeResponse()
    const served = await serveFile(response, root, "hello.txt", {
      contentType: "text/plain",
      cacheControl: "max-age=300"
    })

    expect(served).toBe(true)
    expect(response.getStatusCode()).toBe(200)
    expect(Buffer.from(/** @type {Uint8Array} */ (response.getBody())).toString("utf8")).toBe("hello world")
    expect(response.getHeader("Content-Type")).toEqual(["text/plain"])
    expect(response.getHeader("Cache-Control")).toEqual(["max-age=300"])
    // The body is buffered so the transport emits a Content-Length frame,
    // never a chunked Transfer-Encoding.
    expect(response.getFilePath()).toBeNull()
  })

  it("defaults to application/octet-stream and no-store when no options are given", async () => {
    await writeFile(root, "data.bin", "binary")

    const response = makeResponse()
    const served = await serveFile(response, root, "data.bin")

    expect(served).toBe(true)
    expect(response.getHeader("Content-Type")).toEqual(["application/octet-stream"])
    expect(response.getHeader("Cache-Control")).toEqual(["no-store"])
  })

  it("serves a file nested inside the root", async () => {
    await writeFile(root, "sub/dir/app.js", "console.log(1)")

    const response = makeResponse()
    const served = await serveFile(response, root, "sub/dir/app.js", {contentType: "text/javascript"})

    expect(served).toBe(true)
    expect(Buffer.from(/** @type {Uint8Array} */ (response.getBody())).toString("utf8")).toBe("console.log(1)")
  })

  it("returns 404 for a missing file", async () => {
    const response = makeResponse()

    const served = await serveFile(response, root, "does-not-exist.txt")

    expect(served).toBe(false)
    expect(response.getStatusCode()).toBe(404)
  })

  it("rejects names that escape the root directory", async () => {
    await writeFile(root, "secret.txt", "top secret")

    const response = makeResponse()
    const served = await serveFile(response, root, "../secret.txt")

    expect(served).toBe(false)
    expect(response.getStatusCode()).toBe(404)
  })

  it("rejects absolute names", async () => {
    const response = makeResponse()

    const served = await serveFile(response, root, "/etc/hostname")

    expect(served).toBe(false)
    expect(response.getStatusCode()).toBe(404)
  })

  it("rejects symlink escapes out of the root", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-serve-file-outside-"))
    const outsideFile = path.join(outside, "secret.txt")
    await fs.writeFile(outsideFile, "outside")
    const linkPath = path.join(root, "link.txt")
    await fs.symlink(outsideFile, linkPath)

    try {
      const response = makeResponse()
      const served = await serveFile(response, root, "link.txt")

      expect(served).toBe(false)
      expect(response.getStatusCode()).toBe(404)
    } finally {
      await fs.rm(outside, {recursive: true, force: true})
    }
  })

  it("rejects directories", async () => {
    await fs.mkdir(path.join(root, "subdir"), {recursive: true})

    const response = makeResponse()
    const served = await serveFile(response, root, "subdir")

    expect(served).toBe(false)
    expect(response.getStatusCode()).toBe(404)
  })

  it("returns 404 for an empty or blank name", async () => {
    const response = makeResponse()
    expect(await serveFile(response, root, "")).toBe(false)
    expect(response.getStatusCode()).toBe(404)
  })
})
