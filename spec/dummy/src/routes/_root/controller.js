import fs from "fs/promises"
import path from "path"
import Controller from "../../../../../src/controller.js"
import MemoryUploadedFile from "../../../../../src/http-server/client/uploaded-file/memory-uploaded-file.js"
import TemporaryUploadedFile from "../../../../../src/http-server/client/uploaded-file/temporary-uploaded-file.js"
import wait from "awaitery/build/wait.js"

export default class RootController extends Controller {
  async missingView() {
    await this.render()
  }

  async ping() {
    await this.render({
      json: {
        message: "Pong"
      }
    })
  }

  async pingWithStatus() {
    // Exercises `render({json, status})` returning the configured numeric
    // status alongside the JSON body — the previous render path silently
    // dropped the status and shipped 200.
    await this.render({
      json: {
        message: "Rejected",
        status: "error"
      },
      status: 422
    })
  }

  async pingNoBody() {
    // Exercises a no-body status code (204) — the response sender must
    // suppress the body + Content-Length header per RFC 7230 §3.3.3 so
    // keep-alive clients are not desynchronized waiting for bytes that
    // will not arrive.
    await this.render({
      json: {
        ignored: true
      },
      status: 204
    })
  }

  async params() {
    this.viewParams.response = {
      params: super.params(),
      getParams: this.getParams(),
      queryParameters: this.queryParameters()
    }

    await this.render()
  }

  async slow() {
    const queryParameters = this.queryParameters()
    const waitSeconds = Number(queryParameters.waitSeconds || 0)
    const timeoutSeconds = queryParameters.timeoutSeconds

    if (timeoutSeconds !== undefined) {
      this.response().setRequestTimeoutMs(Number(timeoutSeconds))
    }

    if (Number.isFinite(waitSeconds) && waitSeconds > 0) {
      await wait(waitSeconds * 1000)
    }

    await this.render({
      json: {
        status: "success"
      }
    })
  }

  async upload() {
    const uploadedFile = this.getParams().image

    if (!uploadedFile) {
      await this.render({json: {status: "missing-file"}})
      return
    }

    const baseDir = process.env.VELOCIOUS_TEST_DIR || process.cwd()
    const uploadsDir = path.join(baseDir, "tmp", "uploads")

    await fs.mkdir(uploadsDir, {recursive: true})

    const destinationPath = path.join(uploadsDir, `${Date.now()}-${uploadedFile.filename()}`)

    await uploadedFile.saveTo(destinationPath)

    const stat = await fs.stat(destinationPath)
    const storageType = uploadedFile instanceof MemoryUploadedFile ? "memory" : uploadedFile instanceof TemporaryUploadedFile ? "temporary" : "unknown"

    await this.render({json: {
      status: "success",
      upload: {
        className: uploadedFile.constructor.name,
        contentType: uploadedFile.contentType(),
        destinationPath,
        fieldName: uploadedFile.fieldName(),
        filename: uploadedFile.filename(),
        savedSize: stat.size,
        size: uploadedFile.size(),
        storageType,
        temporaryPath: uploadedFile instanceof TemporaryUploadedFile ? uploadedFile.getPath() : null
      }
    }})
  }
}
