// @ts-check

import RecordAttachmentDownload from "./download.js"
import {recordAttachmentsStoreForModel} from "./store.js"

/**
 * Runs download from row.
 * @param {object} args - Options.
 * @param {Record<string, ?>} args.row - Raw row.
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
 * Runs is array.
 * @param {?} value - Candidate value.
 * @returns {value is Array<?>} - Whether value is an array.
 */
function isArray(value) {
  return Array.isArray(value)
}

/**
 * Attachment helper bound to one model + attachment name.
 */
export default class RecordAttachmentHandle {
  /**
   * Pending inputs.
   * @type {Array<?>} */
  pendingInputs = []

  /**
   * Runs constructor.
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

  /**
   * Runs has pending attachments.
   * @returns {boolean} - Whether there are pending attachment writes.
   */
  hasPendingAttachments() {
    return this.pendingInputs.length > 0
  }

  /**
   * Runs queue attach.
   * @param {?} input - Attachment input.
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
   * Runs attach.
   * @param {?} input - Attachment input.
   * @returns {Promise<void>} - Resolves when attached.
   */
  async attach(input) {
    this.queueAttach(input)
    await this.flushPendingAttachments()
  }

  /**
   * Runs flush pending attachments.
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
   * Runs download.
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
   * Runs download all.
   * @returns {Promise<Array<RecordAttachmentDownload>>} - Downloaded attachments.
   */
  async downloadAll() {
    if (!this.model.isPersisted()) return []

    const store = recordAttachmentsStoreForModel(this.model)
    const rows = await store.findMany({model: this.model, name: this.name})
    /**
     * Downloads.
     * @type {RecordAttachmentDownload[]} */
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
   * Runs list metadata. Returns metadata (no content bytes) for every attachment
   * under this (record, name), so callers can enumerate has-many attachments
   * without downloading their content.
   * @returns {Promise<Array<{byteSize: number, contentType: string | null, filename: string, id: string, url: string | null}>>} - Attachment metadata entries.
   */
  async listMetadata() {
    if (!this.model.isPersisted()) return []

    const store = recordAttachmentsStoreForModel(this.model)
    const rows = await store.findMany({model: this.model, name: this.name})
    /**
     * Metadata entries.
     * @type {Array<{byteSize: number, contentType: string | null, filename: string, id: string, url: string | null}>} */
    const entries = []

    for (const row of rows) {
      const url = await store.attachmentRowUrl({model: this.model, name: this.name, row})
      const byteSize = Number(row.byte_size)

      entries.push({
        byteSize: Number.isFinite(byteSize) ? byteSize : 0,
        contentType: row.content_type || null,
        filename: row.filename || "attachment.bin",
        id: row.id,
        url
      })
    }

    return entries
  }

  /**
   * Runs url.
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
