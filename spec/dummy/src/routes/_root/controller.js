import fs from "fs/promises"
import path from "path"
import Controller from "../../../../../src/controller.js"
import MemoryUploadedFile from "../../../../../src/http-server/client/uploaded-file/memory-uploaded-file.js"
import TemporaryUploadedFile from "../../../../../src/http-server/client/uploaded-file/temporary-uploaded-file.js"

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

  async params() {
    this.viewParams.response = {
      params: super.params(),
      getParams: this.getParams(),
      queryParameters: this.queryParameters()
    }

    await this.render()
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
