// @ts-check

import RecordAttachmentDownload from "./download.js"
import {recordAttachmentsStoreForModel} from "./store.js"

/**
 * @param {Record<string, any>} row - Raw row.
 * @returns {RecordAttachmentDownload} - Download payload.
 */
function downloadFromRow(row) {
  const contentBase64 = typeof row.content_base64 === "string" ? row.content_base64 : ""
  const byteSize = Number(row.byte_size)

  return new RecordAttachmentDownload({
    byteSize: Number.isFinite(byteSize) ? byteSize : Buffer.from(contentBase64, "base64").length,
    content: Buffer.from(contentBase64, "base64"),
    contentType: row.content_type ? String(row.content_type) : null,
    filename: row.filename ? String(row.filename) : "attachment.bin",
    id: String(row.id)
  })
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is Array<unknown>} - Whether value is an array.
 */
function isArray(value) {
  return Array.isArray(value)
}

/**
 * Attachment helper bound to one model + attachment name.
 */
export default class RecordAttachmentHandle {
  /**
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {"hasOne" | "hasMany"} args.type - Attachment type.
   */
  constructor({model, name, type}) {
    this.model = model
    this.name = name
    this.type = type
    this.pendingInputs = []
  }

  /** @returns {boolean} - Whether there are pending attachment writes. */
  hasPendingAttachments() {
    return this.pendingInputs.length > 0
  }

  /**
   * @param {unknown} input - Attachment input.
   * @returns {void} - Queues attachment write for next save.
   */
  queueAttach(input) {
    if (this.type === "hasMany" && isArray(input)) {
      for (const inputEntry of input) {
        this.pendingInputs.push(inputEntry)
      }
    } else {
      this.pendingInputs.push(input)
    }
  }

  /**
   * @param {unknown} input - Attachment input.
   * @returns {Promise<void>} - Resolves when attached.
   */
  async attach(input) {
    this.queueAttach(input)
    await this.flushPendingAttachments()
  }

  /**
   * @returns {Promise<void>} - Resolves when pending attachments are flushed.
   */
  async flushPendingAttachments() {
    if (!this.model.isPersisted()) return
    if (this.pendingInputs.length < 1) return

    const store = recordAttachmentsStoreForModel(this.model)
    const pendingInputs = this.pendingInputs

    this.pendingInputs = []

    for (const [index, input] of pendingInputs.entries()) {
      await store.attach({
        input,
        model: this.model,
        name: this.name,
        replace: this.type === "hasOne" && index === 0
      })
    }
  }

  /**
   * @param {string} [id] - Optional attachment id for has-many attachments.
   * @returns {Promise<RecordAttachmentDownload | null>} - Downloaded attachment.
   */
  async download(id) {
    if (!this.model.isPersisted()) return null

    const store = recordAttachmentsStoreForModel(this.model)
    const row = await store.findOne({id, model: this.model, name: this.name})

    if (!row) return null

    return downloadFromRow(row)
  }

  /**
   * @returns {Promise<Array<RecordAttachmentDownload>>} - Downloaded attachments.
   */
  async downloadAll() {
    if (!this.model.isPersisted()) return []

    const store = recordAttachmentsStoreForModel(this.model)
    const rows = await store.findMany({model: this.model, name: this.name})

    return rows.map((row) => downloadFromRow(row))
  }
}
