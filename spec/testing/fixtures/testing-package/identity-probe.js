// @ts-check

import { forcedString } from "typanic"

const mode = forcedString(process.argv[2], "probe mode")
const facadePath = new URL("../../../../src/testing/test.js", import.meta.url).href
const adapterPath = new URL("../../../../src/testing/testing-package-adapter.js", import.meta.url).href

if (mode === "facade-package-order") {
  const order = forcedString(process.argv[3], "import order")
  let facadeImport
  let packageImport

  if (order === "facade-first") {
    facadeImport = await import(facadePath)
    packageImport = await import("@velocious/testing")
  } else if (order === "package-first") {
    packageImport = await import("@velocious/testing")
    facadeImport = await import(facadePath)
  } else {
    throw new Error(`Unsupported import order: ${order}`)
  }

  await facadeImport.describe("facade declaration", () => {
    facadeImport.it("facade test", () => {})
  })
  await packageImport.describe("package declaration", () => {
    packageImport.it("package test", () => {})
  })

  const adapterImport = await import(adapterPath)

  adapterImport.synchronizeTestingPackageTests(facadeImport.tests)

  console.log([
    `protocol=${packageImport.defaultTestContext.protocolMajor}/${packageImport.defaultTestContext.schemaVersion}`,
    `facade=${Boolean(facadeImport.tests.subs["facade declaration"]?.tests["facade test"])}`,
    `package=${Boolean(facadeImport.tests.subs["package declaration"]?.tests["package test"])}`
  ].join("|"))
} else if (mode === "compatible-copies") {
  const firstPath = forcedString(process.argv[3], "first package path")
  const secondPath = forcedString(process.argv[4], "second package path")
  const firstImport = await import(firstPath)
  const secondImport = await import(secondPath)

  await firstImport.describe("shared physical declaration", () => {
    firstImport.it("visible from either copy", () => {})
  })

  console.log([
    `same=${firstImport.defaultTestContext === secondImport.defaultTestContext}`,
    `visible=${secondImport.defaultTestContext.registry.suites[0]?.name === "shared physical declaration"}`,
    `protocol=${firstImport.defaultTestContext.protocolMajor}/${firstImport.defaultTestContext.schemaVersion}`
  ].join("|"))
} else if (mode === "incompatible-copies") {
  const order = forcedString(process.argv[3], "import order")
  const packagePath = forcedString(process.argv[4], "package path")

  try {
    if (order === "package-first") {
      await import(packagePath)
      await import("./schema-2-copy.js")
    } else if (order === "fixture-first") {
      await import("./schema-2-copy.js")
      await import(packagePath)
    } else {
      throw new Error(`Unsupported import order: ${order}`)
    }
    throw new Error("Incompatible package copies loaded without an error")
  } catch (error) {
    if (!(error instanceof Error)) throw error

    console.log(error.message)
  }
} else {
  throw new Error(`Unsupported probe mode: ${mode}`)
}
