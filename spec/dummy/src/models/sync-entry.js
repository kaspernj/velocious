// @ts-check

import ServerSequenceAllocator, {withServerSequence} from "../../../../src/sync/server-sequence-allocator.js"
import SyncEntryBase from "../model-bases/sync-entry.js"

/** Dummy-app sync/change row used to exercise the model-backed sync replay defaults. */
class SyncEntry extends SyncEntryBase {
  /**
   * Scope-partition attribute for the dummy sync feed: published changes
   * persist and broadcast a projectId scope (deliberately not an "event"
   * name - the partition is app-declared, not built into Velocious).
   * @type {string[]}
   */
  static syncScopeAttributes = ["projectId"]
}

withServerSequence(SyncEntry, {allocator: new ServerSequenceAllocator()})

export default SyncEntry
