import FrontendModelBase from "../../src/frontend-models/base.js"

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
      attributes: ["id", "email", "createdAt", "metadata", "nickName"],
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
})
