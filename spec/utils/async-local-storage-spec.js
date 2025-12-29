import {describe, expect, it} from "../../src/testing/test.js"
import {AsyncLocalStorage} from "../../src/utils/async-local-storage.js"

describe("async local storage", () => {
  it("exports AsyncLocalStorage in node environments", () => {
    expect(AsyncLocalStorage).toBeDefined()

    if (AsyncLocalStorage) {
      const storage = new AsyncLocalStorage()
      expect(storage).toBeInstanceOf(AsyncLocalStorage)
    }
  })

  it("stores and retrieves values within a context", async () => {
    if (!AsyncLocalStorage) return

    const storage = new AsyncLocalStorage()
    const value = await storage.run({name: "alice"}, async () => {
      return storage.getStore()?.name
    })

    expect(value).toBe("alice")
  })
})
