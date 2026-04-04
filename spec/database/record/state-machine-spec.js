// @ts-check

import {stateMachine} from "../../../src/database/record/state-machine.js"

/** Minimal mock model class for testing state machine registration without a database. */
class MockModelBase {
  /** @type {Record<string, any>} */
  _attributes = {}

  /** @type {Record<string, [any, any]>} */
  _changes = {}

  /** @type {Array<{name: string, callback: Function}>} */
  static _registeredCallbacks = []

  /**
   * @param {Record<string, any>} attributes
   */
  constructor(attributes = {}) {
    this._attributes = {...attributes}
  }

  /** @returns {typeof MockModelBase} */
  getModelClass() {
    return /** @type {typeof MockModelBase} */ (this.constructor)
  }

  /**
   * @param {string} name
   * @returns {any}
   */
  readAttribute(name) {
    return this._attributes[name]
  }

  /**
   * @param {string} name
   * @param {any} value
   * @returns {void}
   */
  _setAttribute(name, value) {
    const oldValue = this._attributes[name]

    this._attributes[name] = value
    this._changes[name] = [oldValue, value]
  }

  /** @returns {Record<string, [any, any]>} */
  changes() {
    return this._changes
  }

  /** @returns {boolean} */
  isNewRecord() {
    return !this._attributes.id
  }

  /**
   * @param {string} _callbackName
   * @param {Function} callback
   * @returns {void}
   */
  static beforeSave(callback) {
    this._registeredCallbacks.push({callback, name: "beforeSave"})
  }

  /**
   * @param {string} _callbackName
   * @param {Function} callback
   * @returns {void}
   */
  static afterSave(callback) {
    this._registeredCallbacks.push({callback, name: "afterSave"})
  }

  /** Runs registered beforeSave callbacks. */
  async _runBeforeSaveCallbacks() {
    for (const entry of this.getModelClass()._registeredCallbacks) {
      if (entry.name === "beforeSave") {
        await entry.callback(this)
      }
    }
  }

  /** Runs registered afterSave callbacks. */
  async _runAfterSaveCallbacks() {
    for (const entry of this.getModelClass()._registeredCallbacks) {
      if (entry.name === "afterSave") {
        await entry.callback(this)
      }
    }
  }

  /** Simulates a save. */
  async save() {
    await this._runBeforeSaveCallbacks()
    this._attributes.id = this._attributes.id || "mock-id"
    await this._runAfterSaveCallbacks()
  }
}

describe("stateMachine", () => {
  it("registers event methods on the model prototype", () => {
    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {
        queue: {from: "new", to: "queued"},
        run: {from: ["new", "queued"], to: "running"}
      },
      initial: "new",
      states: {
        new: {},
        queued: {},
        running: {}
      }
    })

    const build = new TestBuild({status: "new"})

    expect(typeof build.queue).toEqual("function")
    expect(typeof build.run).toEqual("function")
    expect(typeof build.canQueue).toEqual("function")
    expect(typeof build.canRun).toEqual("function")
  })

  it("transitions state when an event method is called", () => {
    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {
        queue: {from: "new", to: "queued"},
        run: {from: ["new", "queued"], to: "running"}
      },
      initial: "new",
      states: {new: {}, queued: {}, running: {}}
    })

    const build = new TestBuild({status: "new"})

    build.queue()

    expect(build.readAttribute("status")).toEqual("queued")
  })

  it("throws when transitioning from an invalid source state", () => {
    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {
        succeed: {from: "running", to: "succeeded"}
      },
      initial: "new",
      states: {new: {}, running: {}, succeeded: {}}
    })

    const build = new TestBuild({status: "new"})
    let thrownError = null

    try {
      build.succeed()
    } catch (error) {
      thrownError = error
    }

    expect(thrownError).not.toEqual(null)
    expect(thrownError.message).toContain("Cannot transition")
    expect(thrownError.message).toContain("running")
  })

  it("returns true from guard methods when transition is valid", () => {
    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {
        queue: {from: "new", to: "queued"},
        succeed: {from: "running", to: "succeeded"}
      },
      initial: "new",
      states: {new: {}, queued: {}, running: {}, succeeded: {}}
    })

    const build = new TestBuild({status: "new"})

    expect(build.canQueue()).toEqual(true)
    expect(build.canSucceed()).toEqual(false)
  })

  it("supports custom guards on transitions", () => {
    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {
        cancel: {
          from: ["new", "queued"],
          guard: (model) => !model.isNewRecord(),
          to: "cancelled"
        }
      },
      initial: "new",
      states: {cancelled: {}, new: {}, queued: {}}
    })

    const newBuild = new TestBuild({status: "new"})

    expect(newBuild.canCancel()).toEqual(false)

    const persistedBuild = new TestBuild({id: "123", status: "queued"})

    expect(persistedBuild.canCancel()).toEqual(true)
  })

  it("enforces guards in event methods and rejects forbidden transitions", () => {
    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {
        cancel: {
          from: ["new", "queued"],
          guard: (model) => !model.isNewRecord(),
          to: "cancelled"
        }
      },
      initial: "new",
      states: {cancelled: {}, new: {}, queued: {}}
    })

    const newBuild = new TestBuild({status: "new"})
    let thrownError = null

    try {
      newBuild.cancel()
    } catch (error) {
      thrownError = error
    }

    expect(thrownError).not.toEqual(null)
    expect(thrownError.message).toContain("Guard rejected")
    // State should NOT have been mutated
    expect(newBuild.readAttribute("status")).toEqual("new")
  })

  it("tracks the invoked event name so afterSave uses the correct callbacks", async () => {
    /** @type {string[]} */
    const callOrder = []

    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {
        failBuild: {
          after: () => { callOrder.push("failBuild-after") },
          from: "running",
          to: "failed"
        },
        timeOut: {
          after: () => { callOrder.push("timeOut-after") },
          from: "running",
          to: "failed"
        }
      },
      initial: "new",
      states: {failed: {}, new: {}, running: {}}
    })

    // Both events share the same from/to edge — the tracked event name determines which callback fires
    const build = new TestBuild({id: "123", status: "running"})

    build.timeOut()
    await build._runAfterSaveCallbacks()

    expect(callOrder).toEqual(["timeOut-after"])
  })

  it("runs beforeEnter callbacks during save", async () => {
    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }

      /** @param {Date} value */
      setQueuedAt(value) { this._setAttribute("queuedAt", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {
        queue: {from: "new", to: "queued"}
      },
      initial: "new",
      states: {
        new: {},
        queued: {
          beforeEnter: (model) => {
            /** @type {any} */ (model).setQueuedAt(new Date("2026-01-01"))
          }
        }
      }
    })

    const build = new TestBuild({id: "123", status: "new"})

    build.queue()
    await build._runBeforeSaveCallbacks()

    expect(build.readAttribute("queuedAt").toISOString()).toEqual("2026-01-01T00:00:00.000Z")
  })

  it("runs afterEnter callbacks during save", async () => {
    let afterEnterCalled = false

    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {
        succeed: {from: "running", to: "succeeded"}
      },
      initial: "new",
      states: {
        running: {},
        succeeded: {
          afterEnter: () => {
            afterEnterCalled = true
          }
        }
      }
    })

    const build = new TestBuild({id: "123", status: "running"})

    build.succeed()
    await build._runAfterSaveCallbacks()

    expect(afterEnterCalled).toEqual(true)
  })

  it("runs event-level before and after callbacks", async () => {
    /** @type {string[]} */
    const callOrder = []

    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {
        queue: {
          after: () => { callOrder.push("event-after") },
          before: () => { callOrder.push("event-before") },
          from: "new",
          to: "queued"
        }
      },
      initial: "new",
      states: {
        new: {},
        queued: {
          afterEnter: () => { callOrder.push("state-afterEnter") },
          beforeEnter: () => { callOrder.push("state-beforeEnter") }
        }
      }
    })

    const build = new TestBuild({id: "123", status: "new"})

    build.queue()
    await build._runBeforeSaveCallbacks()
    await build._runAfterSaveCallbacks()

    expect(callOrder).toEqual(["event-before", "state-beforeEnter", "state-afterEnter", "event-after"])
  })

  it("supports multiple source states for an event", () => {
    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {
        fail: {from: ["new", "queued", "running"], to: "failed"}
      },
      initial: "new",
      states: {failed: {}, new: {}, queued: {}, running: {}}
    })

    expect(new TestBuild({status: "new"}).canFail()).toEqual(true)
    expect(new TestBuild({status: "queued"}).canFail()).toEqual(true)
    expect(new TestBuild({status: "running"}).canFail()).toEqual(true)
    expect(new TestBuild({status: "failed"}).canFail()).toEqual(false)
  })

  it("exposes the state machine definition for introspection", () => {
    class TestBuild extends MockModelBase {
      /** @param {string} value */
      setStatus(value) { this._setAttribute("status", value) }
    }

    TestBuild._registeredCallbacks = []

    stateMachine(TestBuild, {
      column: "status",
      events: {queue: {from: "new", to: "queued"}},
      initial: "new",
      states: {new: {}, queued: {}}
    })

    const definition = /** @type {any} */ (TestBuild).getStateMachineDefinition()

    expect(definition.initial).toEqual("new")
    expect(/** @type {any} */ (TestBuild).getStateMachineColumn()).toEqual("status")
    expect(/** @type {any} */ (TestBuild).getStateMachineStateNames()).toContain("new")
    expect(/** @type {any} */ (TestBuild).getStateMachineStateNames()).toContain("queued")
  })

  it("defaults to 'state' column when not specified", () => {
    class TestServer extends MockModelBase {
      /** @param {string} value */
      setState(value) { this._setAttribute("state", value) }
    }

    TestServer._registeredCallbacks = []

    stateMachine(TestServer, {
      events: {activate: {from: "inactive", to: "active"}},
      initial: "inactive",
      states: {active: {}, inactive: {}}
    })

    const server = new TestServer({state: "inactive"})

    server.activate()

    expect(server.readAttribute("state")).toEqual("active")
    expect(/** @type {any} */ (TestServer).getStateMachineColumn()).toEqual("state")
  })
})
