import fs from "fs/promises"
import path from "path"
import Controller from "../../../../../src/controller.js"
import MemoryUploadedFile from "../../../../../src/http-server/client/uploaded-file/memory-uploaded-file.js"
import TemporaryUploadedFile from "../../../../../src/http-server/client/uploaded-file/temporary-uploaded-file.js"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"

/** @typedef {{connectionId: number, resolve: (connectionIds: number[]) => void}} ConnectionIdentityWaiter */
/** @type {ConnectionIdentityWaiter[]} */
const connectionIdentityWaiters = []
/** @type {WeakMap<import("../../../../../src/database/drivers/base.js").default, number>} */
const connectionIdentities = new WeakMap()
let nextConnectionIdentity = 1

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

  async concurrentConnectionIdentity() {
    const connection = this.getConfiguration().getDatabasePool("mssql").getCurrentConnection()
    let connectionId = connectionIdentities.get(connection)

    if (connectionId === undefined) {
      connectionId = nextConnectionIdentity++
      connectionIdentities.set(connection, connectionId)
    }

    /** @type {ConnectionIdentityWaiter | undefined} */
    let connectionIdentityWaiter

    try {
      const connectionIds = await timeout({timeout: 2000}, async () => {
        return await new Promise((resolve) => {
          connectionIdentityWaiter = {connectionId, resolve}
          connectionIdentityWaiters.push(connectionIdentityWaiter)

          if (connectionIdentityWaiters.length == 2) {
            const completedWaiters = connectionIdentityWaiters.splice(0)
            const completedConnectionIds = completedWaiters.map((waiter) => waiter.connectionId)

            for (const waiter of completedWaiters) {
              waiter.resolve(completedConnectionIds)
            }
          }
        })
      })

      await this.render({json: {connectionId, connectionIds}})
    } finally {
      const waiterIndex = connectionIdentityWaiter === undefined
        ? -1
        : connectionIdentityWaiters.indexOf(connectionIdentityWaiter)

      if (waiterIndex >= 0) {
        connectionIdentityWaiters.splice(waiterIndex, 1)
      }
    }
  }

  async testRequestTransactionMarker() {
    const connection = this.getConfiguration().getDatabasePool("default").getCurrentConnection()
    const marker = this.getParams().marker
    const projectsTable = connection.quoteTable("projects")
    const markerColumn = connection.quoteColumn("creating_user_reference")

    await connection.query(
      `INSERT INTO ${projectsTable} (${markerColumn}) VALUES (${connection.quote(marker)})`
    )

    const rows = await connection.query(
      `SELECT ${markerColumn} FROM ${projectsTable} WHERE ${markerColumn} = ${connection.quote(marker)}`
    )

    await this.render({json: {
      marker,
      markerCount: rows.length,
      status: "success"
    }})
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
