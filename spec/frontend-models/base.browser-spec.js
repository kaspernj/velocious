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
      attributes: ["id", "email", "createdAt"],
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

describe("Frontend models - base browser integration", () => {
  it("findBy loads through real browser HTTP requests", async () => {
    FrontendModelBase.configureTransport({
      baseUrl: "http://127.0.0.1:4501"
    })

    try {
      const model = await BrowserFrontendModel.findBy({email: "john@example.com"})

      expect(model?.id()).toEqual("2")
      expect(model?.email()).toEqual("john@example.com")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy normalizes Date conditions over real browser HTTP requests", async () => {
    FrontendModelBase.configureTransport({
      baseUrl: "http://127.0.0.1:4501"
    })

    try {
      const model = await BrowserFrontendModel.findBy({createdAt: new Date("2026-02-18T08:00:00.000Z")})

      expect(model?.id()).toEqual("1")
      expect(model?.createdAt()).toEqual("2026-02-18T08:00:00.000Z")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findByOrFail raises when no backend record matches", async () => {
    FrontendModelBase.configureTransport({
      baseUrl: "http://127.0.0.1:4501"
    })

    try {
      await expect(async () => {
        await BrowserFrontendModel.findByOrFail({email: "missing@example.com"})
      }).toThrow(/BrowserFrontendModel not found for conditions/)
    } finally {
      resetFrontendModelTransport()
    }
  })
})
