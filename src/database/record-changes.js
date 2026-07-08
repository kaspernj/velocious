// @ts-check

import EventEmitter from "../utils/event-emitter.js"

/**
 * RecordModelClass type.
 * @typedef {typeof import("./record/index.js").default} RecordModelClass */

/**
 * RecordChangeOperation type.
 * @typedef {"create" | "update" | "destroy"} RecordChangeOperation */

/**
 * RecordChangeEvent type.
 * @typedef {object} RecordChangeEvent
 * @property {RecordModelClass} modelClass - Model class whose row changed.
 * @property {RecordChangeOperation} operation - The committed operation.
 * @property {InstanceType<RecordModelClass>} record - The committed record instance.
 */

/**
 * RecordChangeListener type.
 * @typedef {(event: RecordChangeEvent) => void} RecordChangeListener */

/**
 * Framework-level bus for committed local model changes. Records emit here once
 * per commit (see `VelociousDatabaseRecord.save`/`destroy`), so local writes,
 * pull applies, and realtime applies converge on one uniform signal that live
 * queries subscribe to. Emission is keyed by model name; a `batch(...)` window
 * coalesces a burst of commits into a single event per model class.
 */
class RecordChanges {
  /**
   * Underlying event bus keyed by model name.
   * @type {import("eventemitter3").EventEmitter} */
  _emitter = new EventEmitter()

  /**
   * Number of open batch windows; while positive, emits buffer instead of dispatching.
   * @type {number} */
  _batchDepth = 0

  /**
   * Latest buffered event per model name, dispatched once when the outermost batch ends.
   * @type {Map<string, RecordChangeEvent>} */
  _bufferedEvents = new Map()

  /**
   * Subscribes a listener to committed changes of a model class.
   * @param {RecordModelClass} modelClass - Model class to observe.
   * @param {RecordChangeListener} listener - Listener called with each change event.
   * @returns {() => void} Unsubscribe callback.
   */
  subscribe(modelClass, listener) {
    const eventName = modelClass.getModelName()

    this._emitter.on(eventName, listener)

    return () => {
      this._emitter.off(eventName, listener)
    }
  }

  /**
   * Whether any listener is currently observing the given model class. Callers on
   * the write path use this to skip emitting entirely when nothing is watching,
   * keeping server-side saves free of live-query overhead.
   * @param {RecordModelClass} modelClass - Model class to check.
   * @returns {boolean} Whether listeners exist for the model class.
   */
  hasListeners(modelClass) {
    return this._emitter.listenerCount(modelClass.getModelName()) > 0
  }

  /**
   * Emits a committed change. While a batch window is open the event is buffered
   * and deduplicated by model class, so a batch of N commits dispatches a single
   * event per model class when the outermost batch ends.
   * @param {RecordChangeEvent} event - Change event to dispatch.
   * @returns {void}
   */
  emit(event) {
    if (this._batchDepth > 0) {
      this._bufferedEvents.set(event.modelClass.getModelName(), event)

      return
    }

    this._emitter.emit(event.modelClass.getModelName(), event)
  }

  /**
   * Runs a callback with change dispatch coalesced: every change committed while
   * the callback runs buffers, and the outermost batch flushes a single event per
   * changed model class after it resolves. Nested batches share one flush. Sync
   * appliers wrap their per-row apply loop in this so a large pull or realtime
   * push triggers one re-run per live query instead of one per applied row.
   * @template T
   * @param {() => Promise<T> | T} callback - Work whose committed changes should coalesce.
   * @returns {Promise<T>} The callback result.
   */
  async batch(callback) {
    this._batchDepth++

    try {
      return await callback()
    } finally {
      this._batchDepth--

      if (this._batchDepth === 0) this._flushBufferedEvents()
    }
  }

  /**
   * Dispatches and clears the buffered per-model events collected during a batch.
   * @returns {void}
   */
  _flushBufferedEvents() {
    const bufferedEvents = this._bufferedEvents

    this._bufferedEvents = new Map()

    for (const event of bufferedEvents.values()) {
      this._emitter.emit(event.modelClass.getModelName(), event)
    }
  }
}

/**
 * Shared singleton so record commits and live queries meet on one bus.
 * @type {RecordChanges} */
const recordChanges = new RecordChanges()

export default recordChanges
export {RecordChanges}
