import {loadDefinitions, reloadDefinitions} from "../../../src/testing/factory/node/load-definitions.js"
import {mkdtemp, rm, writeFile} from "node:fs/promises"
import {afterEach, beforeEach, describe, expect, it} from "../../../src/testing/test.js"
import {createFactoryRegistry} from "../../../src/testing/factory/index.js"
import os from "node:os"
import path from "node:path"

const WIDGET_DEFINITION = `export default function(registry) {
  registry.define(({factory}) => {
    factory("loadedWidget", class Widget {}, ({attribute}) => attribute("name", "Loaded"))
  })
}
`

describe("Factory - loadDefinitions (Node)", () => {
  /** @type {string} */
  let directory

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "factory-defs-"))
  })

  afterEach(async () => {
    await rm(directory, {recursive: true, force: true})
  })

  it("loads definition files from a directory in deterministic order", async () => {
    await writeFile(path.join(directory, "a-widgets.js"), WIDGET_DEFINITION)

    const registry = createFactoryRegistry()
    const files = await loadDefinitions(registry, directory)

    expect(files).toHaveLength(1)
    expect(await registry.attributesFor("loadedWidget")).toEqual({name: "Loaded"})
  })

  it("rejects a definition file without a default-exported function", async () => {
    await writeFile(path.join(directory, "broken.js"), "export const notDefault = 1\n")

    const registry = createFactoryRegistry()

    await expect(async () => await loadDefinitions(registry, directory)).toThrow(/must default-export a \(registry\) => void function/)
  })

  it("reloadDefinitions resets the registry and re-imports the edited files", async () => {
    const filePath = path.join(directory, "widgets.js")

    await writeFile(filePath, WIDGET_DEFINITION)

    const registry = createFactoryRegistry()

    await loadDefinitions(registry, directory)

    expect(await registry.attributesFor("loadedWidget")).toEqual({name: "Loaded"})

    await writeFile(filePath, `export default function(registry) {
      registry.define(({factory}) => {
        factory("reloadedWidget", class Widget {}, ({attribute}) => attribute("name", "Reloaded"))
      })
    }
`)

    await reloadDefinitions(registry, directory)

    expect(await registry.attributesFor("reloadedWidget")).toEqual({name: "Reloaded"})
    await expect(async () => await registry.attributesFor("loadedWidget")).toThrow(/No factory/)
  })
})
