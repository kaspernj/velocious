// @ts-check

import RecordAttachmentDownload from "./download.js"
import {recordAttachmentsStoreForModel} from "./store.js"

/**
 * @param {object} args - Options.
 * @param {Record<string, any>} args.row - Raw row.
 * @param {Buffer} args.content - Attachment bytes.
 * @param {string | null} args.url - Attachment URL.
 * @returns {RecordAttachmentDownload} - Download payload.
 */
function downloadFromRow({content, row, url}) {
  const byteSize = Number(row.byte_size)

  return new RecordAttachmentDownload({
    byteSize: Number.isFinite(byteSize) ? byteSize : content.length,
    content,
    contentType: row.content_type || null,
    filename: row.filename || "attachment.bin",
    id: row.id,
    url
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
  /** @type {unknown[]} */
  pendingInputs = []

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
    if (this.type === "hasOne") {
      if (isArray(input)) {
        const lastInput = input[input.length - 1]

        this.pendingInputs = typeof lastInput === "undefined" ? [] : [lastInput]
      } else {
        this.pendingInputs = [input]
      }

      return
    }

    if (isArray(input)) {
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

    const [content, url] = await Promise.all([
      store.readAttachmentRow({model: this.model, name: this.name, row}),
      store.attachmentRowUrl({model: this.model, name: this.name, row})
    ])

    return downloadFromRow({content, row, url})
  }

  /**
   * @returns {Promise<Array<RecordAttachmentDownload>>} - Downloaded attachments.
   */
  async downloadAll() {
    if (!this.model.isPersisted()) return []

    const store = recordAttachmentsStoreForModel(this.model)
    const rows = await store.findMany({model: this.model, name: this.name})
    /** @type {RecordAttachmentDownload[]} */
    const downloads = []

    for (const row of rows) {
      const [content, url] = await Promise.all([
        store.readAttachmentRow({model: this.model, name: this.name, row}),
        store.attachmentRowUrl({model: this.model, name: this.name, row})
      ])

      downloads.push(downloadFromRow({content, row, url}))
    }

    return downloads
  }

  /**
   * @param {string} [id] - Optional attachment id for has-many attachments.
   * @returns {Promise<string | null>} - Resolvable attachment URL.
   */
  async url(id) {
    if (!this.model.isPersisted()) return null

    const store = recordAttachmentsStoreForModel(this.model)
    const row = await store.findOne({id, model: this.model, name: this.name})

    if (!row) return null

    return await store.attachmentRowUrl({model: this.model, name: this.name, row})
  }
}
