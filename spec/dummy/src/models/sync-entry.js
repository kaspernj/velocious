// @ts-check

import ServerSequenceAllocator, {withServerSequence} from "../../../../src/sync/server-sequence-allocator.js"
import SyncEntryBase from "../model-bases/sync-entry.js"

/** Dummy-app sync/change row used to exercise the model-backed sync replay defaults. */
class SyncEntry extends SyncEntryBase {
}

withServerSequence(SyncEntry, {allocator: new ServerSequenceAllocator()})

export default SyncEntry
