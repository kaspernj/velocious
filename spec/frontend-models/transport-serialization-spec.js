// @ts-check

import FrontendModelBase from "../../src/frontend-models/base.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "../../src/frontend-models/transport-serialization.js"

/** Test frontend model for transport serialization specs. */
class TransportTask extends FrontendModelBase {
  /** @returns {{attributes: string[], modelName: string, primaryKey: string}} - Resource config. */
  static resourceConfig() {
    return {
      attributes: ["id", "name"],
      modelName: "TransportTask",
      primaryKey: "id"
    }
  }

  /** @returns {number} - Task id. */
  id() { return this.readAttribute("id") }

  /** @returns {string} - Task name. */
  name() { return this.readAttribute("name") }
}

FrontendModelBase.registerModel(TransportTask)

describe("Frontend models - transport serialization", () => {
  it("does not prototype-pollute during deserialize for __proto__ keys", () => {
    const payload = /** @type {Record<string, any>} */ (JSON.parse("{\"safe\":1,\"__proto__\":{\"polluted\":true}}"))

    try {
      const deserialized = /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(payload))

      expect(Object.prototype.polluted).toEqual(undefined)
      expect(Object.prototype.hasOwnProperty.call(deserialized, "__proto__")).toEqual(true)
      expect(deserialized["__proto__"].polluted).toEqual(true)
      expect(Object.getPrototypeOf(deserialized)).toBe(Object.prototype)
    } finally {
      delete Object.prototype.polluted
    }
  })

  it("does not prototype-pollute during serialize for __proto__ keys", () => {
    const payload = /** @type {Record<string, any>} */ (JSON.parse("{\"safe\":1,\"__proto__\":{\"polluted\":true}}"))

    try {
      const serialized = /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue(payload))

      expect(Object.prototype.polluted).toEqual(undefined)
      expect(Object.prototype.hasOwnProperty.call(serialized, "__proto__")).toEqual(true)
      expect(serialized["__proto__"].polluted).toEqual(true)
      expect(Object.getPrototypeOf(serialized)).toBe(Object.prototype)
    } finally {
      delete Object.prototype.polluted
    }
  })

  it("hydrates serialized backend models into registered frontend models", () => {
    const backendTask = {
      attributes: () => ({
        id: 42,
        name: "Transport task"
      }),
      constructor: {
        getModelName: () => "TransportTask"
      },
      getModelClass: () => ({
        getRelationshipsMap: () => ({})
      }),
      getRelationshipByName: () => {
        throw new Error("No relationships should be read in this spec")
      }
    }

    const payload = serializeFrontendModelTransportValue({
      task: backendTask,
      tasks: [backendTask]
    })
    const deserialized = /** @type {{task: TransportTask, tasks: TransportTask[]}} */ (deserializeFrontendModelTransportValue(payload))

    expect(deserialized.task instanceof TransportTask).toEqual(true)
    expect(deserialized.task.id()).toEqual(42)
    expect(deserialized.task.name()).toEqual("Transport task")
    expect(deserialized.task.isPersisted()).toEqual(true)
    expect(deserialized.tasks[0] instanceof TransportTask).toEqual(true)
  })

  it("requires an own frontend-model marker key during deserialize", () => {
    const previousMarker = Object.prototype.__velocious_type

    try {
      Object.prototype.__velocious_type = "frontend_model"

      const payload = {
        attributes: {
          id: 9,
          name: "Plain task"
        },
        modelName: "TransportTask",
        safe: true
      }
      const deserialized = /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(payload))

      expect(deserialized instanceof TransportTask).toEqual(false)
      expect(deserialized.modelName).toEqual("TransportTask")
      expect(deserialized.safe).toEqual(true)
    } finally {
      if (previousMarker === undefined) {
        delete Object.prototype.__velocious_type
      } else {
        Object.prototype.__velocious_type = previousMarker
      }
    }
  })
})
