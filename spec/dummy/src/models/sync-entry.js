// @ts-check

import SyncEntryBase from "../model-bases/sync-entry.js"

/** Dummy-app sync/change row used to exercise the model-backed sync replay defaults. */
class SyncEntry extends SyncEntryBase {
  /** @returns {Promise<void>} Assigns the next server-side sequence. */
  async advanceServerSequence() {
    const latestEntry = await SyncEntry.order("server_sequence DESC").first()

    this.setServerSequence((latestEntry?.serverSequence() || 0) + 1)
  }
}

export default SyncEntry
