// @ts-check

import { deferred } from "awaitery"
import sha256BytesHex from "../../src/utils/sha256-bytes-hex.js"

/** @typedef {import("../../src/sync/assets/types.js").SynchronizedAssetCacheDescriptor} SynchronizedAssetCacheDescriptor */
/** @typedef {import("../../src/sync/assets/types.js").SynchronizedAssetCacheState} SynchronizedAssetCacheState */

/** In-memory adapter exercising the platform storage contract. */
export class MemoryAssetCacheAdapter {
  constructor() {
    /** @type {Map<string, SynchronizedAssetCacheState>} */
    this.states = new Map()
    /** @type {Map<string, Uint8Array>} */
    this.blobs = new Map()
    /** @type {string[]} */
    this.deletedBlobKeys = []
  }

  /** @param {{accountId: string}} args Account namespace. @returns {Promise<SynchronizedAssetCacheState | null>} Persisted state. */
  async loadState({accountId}) {
    return structuredClone(this.states.get(accountId) || null)
  }

  /** @param {{accountId: string, state: SynchronizedAssetCacheState}} args State write. @returns {Promise<void>} */
  async saveState({accountId, state}) {
    this.states.set(accountId, structuredClone(state))
  }

  /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<string | null>} Resolvable URI. */
  async blobUri({accountId, digest}) {
    const key = `${accountId}:${digest}`

    return this.blobs.has(key) ? `memory://${key}` : null
  }

  /** @param {{accountId: string, bytes: Uint8Array, contentType: string | null, digest: string}} args Blob write. @returns {Promise<string>} Resolvable URI. */
  async writeBlob({accountId, bytes, contentType, digest}) {
    void contentType
    const key = `${accountId}:${digest}`

    this.blobs.set(key, bytes.slice())

    return `memory://${key}`
  }

  /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<void>} */
  async deleteBlob({accountId, digest}) {
    const key = `${accountId}:${digest}`

    this.deletedBlobKeys.push(key)
    this.blobs.delete(key)
  }
}

/** Adapter that exposes overlapping metadata persistence. */
export class DelayedSaveAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.activeSaveCount = 0
    this.maximumActiveSaveCount = 0
  }

  /** @param {{accountId: string, state: SynchronizedAssetCacheState}} args State write. @returns {Promise<void>} */
  async saveState(args) {
    this.activeSaveCount += 1
    this.maximumActiveSaveCount = Math.max(this.maximumActiveSaveCount, this.activeSaveCount)
    await Promise.resolve()
    await super.saveState(args)
    this.activeSaveCount -= 1
  }
}

/** Adapter that can reject exactly the next metadata write. */
export class FailNextSaveAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.failNextSave = false
  }

  /** @param {{accountId: string, state: SynchronizedAssetCacheState}} args State write. @returns {Promise<void>} */
  async saveState(args) {
    if (this.failNextSave) {
      this.failNextSave = false
      throw new Error("planned metadata persistence failure")
    }

    await super.saveState(args)
  }
}

/** Adapter that rejects one selected metadata write. */
export class FailSelectedSaveAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.failOnSaveCount = null
    this.saveCount = 0
  }

  /** @param {{accountId: string, state: SynchronizedAssetCacheState}} args State write. @returns {Promise<void>} */
  async saveState(args) {
    this.saveCount += 1

    if (this.saveCount === this.failOnSaveCount) throw new Error("planned selected metadata persistence failure")

    await super.saveState(args)
  }
}

/** Adapter that pauses before rejecting one selected metadata write. */
export class PausedFailingSaveAssetCacheAdapter extends FailSelectedSaveAssetCacheAdapter {
  constructor() {
    super()
    this.releaseFailingSave = deferred()
    this.failingSaveStarted = deferred()
  }

  /** @param {{accountId: string, state: SynchronizedAssetCacheState}} args State write. @returns {Promise<void>} */
  async saveState(args) {
    if (this.saveCount + 1 === this.failOnSaveCount) {
      this.failingSaveStarted.resolve(undefined)
      await this.releaseFailingSave.promise
    }

    await super.saveState(args)
  }
}

/** Adapter that pauses the next metadata write after committing it. */
export class PausedSaveAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.pauseNextSave = false
    this.releaseSave = deferred()
    this.saveCommitted = deferred()
  }

  /** @param {{accountId: string, state: SynchronizedAssetCacheState}} args State write. @returns {Promise<void>} */
  async saveState(args) {
    await super.saveState(args)

    if (!this.pauseNextSave) return

    this.pauseNextSave = false
    this.saveCommitted.resolve(undefined)
    await this.releaseSave.promise
  }
}

/** Adapter that can reject exactly the next blob deletion. */
export class FailNextDeleteAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.deletionAttempts = 0
    this.failNextDelete = false
  }

  /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<void>} */
  async deleteBlob(args) {
    this.deletionAttempts += 1

    if (this.failNextDelete) {
      this.failNextDelete = false
      throw new Error("planned blob deletion failure")
    }

    await super.deleteBlob(args)
  }
}

/** Adapter that pauses exactly the next blob deletion before removing bytes. */
export class PausedDeleteAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.blobDeletionStarted = deferred()
    this.releaseBlobDeletion = deferred()
  }

  /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<void>} */
  async deleteBlob(args) {
    this.blobDeletionStarted.resolve(undefined)
    await this.releaseBlobDeletion.promise
    await super.deleteBlob(args)
  }
}

/** Adapter that pauses after atomically committing blob bytes. */
export class PausedWriteAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.blobWriteCommitted = deferred()
    this.releaseBlobWrite = deferred()
  }

  /** @param {{accountId: string, bytes: Uint8Array, contentType: string | null, digest: string}} args Blob write. @returns {Promise<string>} Resolvable URI. */
  async writeBlob(args) {
    const uri = await super.writeBlob(args)

    this.blobWriteCommitted.resolve(undefined)
    await this.releaseBlobWrite.promise

    return uri
  }
}

/** Adapter that pauses exactly the next local blob lookup. */
export class PausedBlobLookupAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.blobLookupStarted = deferred()
    this.pauseNextBlobLookup = false
    this.releaseBlobLookup = deferred()
  }

  /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<string | null>} Resolvable URI. */
  async blobUri(args) {
    if (this.pauseNextBlobLookup) {
      this.pauseNextBlobLookup = false
      this.blobLookupStarted.resolve(undefined)
      await this.releaseBlobLookup.promise
    }

    return await super.blobUri(args)
  }
}

/**
 * Builds an immutable synchronized attachment descriptor.
 * @param {object} args Descriptor overrides.
 * @param {Uint8Array} args.bytes Expected content bytes.
 * @param {"eager" | "on-demand"} [args.fetch] Fetch policy.
 * @param {string} [args.id] Attachment id.
 * @param {"optional" | "required"} [args.offlineRequirement] Offline requirement.
 * @param {"durable" | "evictable"} [args.retention] Retention policy.
 * @returns {SynchronizedAssetCacheDescriptor} Descriptor.
 */
export function descriptor({bytes, fetch = "eager", id = "attachment-1", offlineRequirement = "optional", retention = "evictable"}) {
  return {
    byteSize: bytes.byteLength,
    contentType: "image/png",
    digest: `sha256-${sha256BytesHex(bytes)}`,
    filename: `${id}.png`,
    id,
    name: "profilePicture",
    offlineRequirement,
    recordId: "user-1",
    recordType: "User",
    fetch,
    retention
  }
}

/** @param {number[]} values Byte values. @returns {Uint8Array} Bytes. */
export function bytes(values) {
  return Uint8Array.from(values)
}
