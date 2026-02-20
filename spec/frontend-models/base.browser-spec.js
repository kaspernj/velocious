import FrontendModelBase, {AttributeNotSelectedError} from "../../src/frontend-models/base.js"

/** Frontend model used for browser integration tests against dummy backend routes. */
class BrowserFrontendModel extends FrontendModelBase {
  /**
   * @returns {{attributes: string[], abilities: {find: string, index: string}, commands: {find: string, index: string}, path: string, primaryKey: string}} - Resource config.
   */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id", "email", "createdAt", "metadata", "nickName", "tags"],
      commands: {
        find: "frontend-find",
        index: "frontend-index"
      },
      path: "/frontend-model-system-tests",
      primaryKey: "id"
    }
  }

  /** @returns {unknown} */
  id() { return this.readAttribute("id") }

  /** @returns {unknown} */
  email() { return this.readAttribute("email") }

  /** @returns {unknown} */
  createdAt() { return this.readAttribute("createdAt") }
}

/** Frontend model comment class for browser preload integration tests. */
class BrowserPreloadComment extends FrontendModelBase {
  /**
   * @returns {{abilities: {index: string}, attributes: string[], commands: {index: string}, path: string, primaryKey: string}}
   */
  static resourceConfig() {
    return {
      abilities: {
        index: "read"
      },
      attributes: ["id", "body"],
      commands: {
        index: "frontend-index"
      },
      path: "/frontend-model-system-tests",
      primaryKey: "id"
    }
  }
}

/** Frontend model task class for browser preload integration tests. */
class BrowserPreloadTask extends FrontendModelBase {
  /**
   * @returns {{abilities: {index: string}, attributes: string[], commands: {index: string}, path: string, primaryKey: string}}
   */
  static resourceConfig() {
    return {
      abilities: {
        index: "read"
      },
      attributes: ["id", "name"],
      commands: {
        index: "frontend-index"
      },
      path: "/frontend-model-system-tests",
      primaryKey: "id"
    }
  }

  /**
   * @returns {Record<string, typeof FrontendModelBase>}
   */
  static relationshipModelClasses() {
    return {
      comments: BrowserPreloadComment
    }
  }

  /**
   * @returns {Record<string, {type: "hasMany"}>}
   */
  static relationshipDefinitions() {
    return {
      comments: {type: "hasMany"}
    }
  }

  /** @returns {unknown} */
  primaryInteraction() { return this.getRelationshipByName("primaryInteraction").loaded() }
}

/** Frontend model project class for browser preload integration tests. */
class BrowserPreloadProject extends FrontendModelBase {
  /**
   * @returns {{abilities: {index: string}, attributes: string[], commands: {index: string}, path: string, primaryKey: string}}
   */
  static resourceConfig() {
    return {
      abilities: {
        index: "read"
      },
      attributes: ["id", "email"],
      commands: {
        index: "frontend-index"
      },
      path: "/frontend-model-system-tests",
      primaryKey: "id"
    }
  }

  /**
   * @returns {Record<string, typeof FrontendModelBase>}
   */
  static relationshipModelClasses() {
    return {
      tasks: BrowserPreloadTask
    }
  }

  /**
   * @returns {Record<string, {type: "hasMany"}>}
   */
  static relationshipDefinitions() {
    return {
      tasks: {type: "hasMany"}
    }
  }
}

/** @returns {void} */
function resetFrontendModelTransport() {
  FrontendModelBase.configureTransport({
    baseUrl: undefined,
    baseUrlResolver: undefined,
    credentials: undefined,
    pathPrefix: undefined,
    pathPrefixResolver: undefined,
    request: undefined
  })
}

/** @returns {boolean} */
function runBrowserHttpIntegration() {
  return process.env.VELOCIOUS_BROWSER_TESTS === "true"
}

/** @returns {void} */
function configureBrowserTransport() {
  const configuredPort = Number(process.env.VELOCIOUS_BROWSER_BACKEND_PORT)
  const backendPort = Number.isFinite(configuredPort) ? configuredPort : 4501

  FrontendModelBase.configureTransport({
    baseUrl: `http://127.0.0.1:${backendPort}`
  })
}

describe("Frontend models - base browser integration", () => {
  it("findBy loads through real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const model = await BrowserFrontendModel.findBy({email: "john@example.com"})

      expect(model?.id()).toEqual("2")
      expect(model?.email()).toEqual("john@example.com")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy matches numeric id conditions against string ids over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const model = await BrowserFrontendModel.findBy({id: 2})

      expect(model?.id()).toEqual("2")
      expect(model?.email()).toEqual("john@example.com")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy normalizes Date conditions over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const model = await BrowserFrontendModel.findBy({createdAt: new Date("2026-02-18T08:00:00.000Z")})

      expect(model?.id()).toEqual("1")
      expect(model?.createdAt()).toEqual("2026-02-18T08:00:00.000Z")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy matches nested object conditions by value over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const model = await BrowserFrontendModel.findBy({metadata: {region: "eu"}})

      expect(model?.id()).toEqual("2")
      expect(model?.email()).toEqual("john@example.com")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy matches exact array attribute values over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const model = await BrowserFrontendModel.findBy({tags: ["a", "b"]})

      expect(model?.id()).toEqual("2")
      expect(model?.email()).toEqual("john@example.com")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy only matches explicit null values over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const model = await BrowserFrontendModel.findBy({nickName: null})

      expect(model?.id()).toEqual("2")
      expect(model?.email()).toEqual("john@example.com")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy returns null when no backend record matches", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const model = await BrowserFrontendModel.findBy({email: "missing@example.com"})

      expect(model).toEqual(null)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findByOrFail raises when no backend record matches", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await expect(async () => {
        await BrowserFrontendModel.findByOrFail({email: "missing@example.com"})
      }).toThrow(/BrowserFrontendModel not found for conditions/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy raises when conditions include undefined", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await expect(async () => {
        await BrowserFrontendModel.findBy({email: undefined})
      }).toThrow(/findBy does not support undefined condition values/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy raises when conditions include non-plain objects", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await expect(async () => {
        await BrowserFrontendModel.findBy({email: /john/i})
      }).toThrow(/findBy does not support non-plain object condition values/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy raises when conditions is not a plain object", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await expect(async () => {
        await BrowserFrontendModel.findBy(/** @type {any} */ (5))
      }).toThrow(/findBy expects conditions to be a plain object/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy raises when conditions include symbol keys", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const key = Symbol("id")

      await expect(async () => {
        await BrowserFrontendModel.findBy({[key]: "2"})
      }).toThrow(/findBy does not support symbol condition keys/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findByOrFail raises when conditions include undefined", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await expect(async () => {
        await BrowserFrontendModel.findByOrFail({email: undefined})
      }).toThrow(/findBy does not support undefined condition values/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("preloads nested relationships over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const projects = await BrowserPreloadProject
        .preload({tasks: ["comments"]})
        .toArray()
      const tasks = projects[0].getRelationshipByName("tasks").loaded()
      const commentsForFirstTask = tasks[0].getRelationshipByName("comments").loaded()

      expect(tasks.length).toEqual(1)
      expect(commentsForFirstTask.length).toEqual(1)

      await expect(async () => {
        tasks[0].primaryInteraction()
      }).toThrow(/BrowserPreloadTask#primaryInteraction hasn't been preloaded/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("throws AttributeNotSelectedError for non-selected frontend attributes", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const projects = await BrowserPreloadProject
        .preload(["tasks"])
        .select({
          BrowserPreloadProject: ["id"],
          BrowserPreloadTask: ["updatedAt"]
        })
        .toArray()
      const tasks = projects[0].getRelationshipByName("tasks").loaded()

      expect(tasks[0].readAttribute("updatedAt")).toEqual("2026-02-20T10:00:00.000Z")
      expect(() => tasks[0].readAttribute("id")).toThrow(/BrowserPreloadTask#id was not selected/)

      let thrownError = null

      try {
        tasks[0].readAttribute("id")
      } catch (error) {
        thrownError = error
      }

      expect(thrownError instanceof AttributeNotSelectedError).toEqual(true)
    } finally {
      resetFrontendModelTransport()
    }
  })
})
