// @ts-check

import { forcedString } from "typanic"

const mode = forcedString(process.argv[2], "probe mode")
const facadePath = new URL("../../../../src/testing/test.js", import.meta.url).href

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

  console.log([
    `protocol=${packageImport.defaultTestContext.protocolMajor}/${packageImport.defaultTestContext.schemaVersion}`,
    `sharedDsl=${facadeImport.describe === packageImport.describe}`,
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
} else if (mode === "compatible-runtime-copies") {
  const firstPath = forcedString(process.argv[3], "first package path")
  const secondPath = forcedString(process.argv[4], "second package path")
  const firstImport = await import(firstPath)
  const secondImport = await import(secondPath)
  const firstRunnerImport = await import(new URL("runner.js", firstPath).href)
  const secondRunnerImport = await import(new URL("runner.js", secondPath).href)
  const context = firstImport.defaultTestContext
  const eventTypes = []
  let standalonePlainArity
  let standaloneRowArguments

  context.reset({config: true})
  context.events.on("runner", (event) => eventTypes.push(event.type))
  await secondImport.describe("compatible runtime", () => {
    firstImport.it("passes", function () {
      standalonePlainArity = arguments.length
      firstImport.expect(2 + 2).toEqual(4)
    })
    secondImport.it.each([[1, 2]])("standalone row", function (left, right) {
      standaloneRowArguments = [left, right, arguments.length]
    })
  })
  const firstResult = await new firstRunnerImport.TestRunner({context}).run()
  context.reset({config: true})
  await firstImport.describe("deadline runtime", () => {
    secondImport.it("times out", {
      databaseCleaning: {transaction: false, truncate: false},
      timeoutMs: 5
    }, async () => await new Promise(() => {}))
  })
  const fakeTimers = secondImport.createFakeTimers()
  let secondResult

  fakeTimers.install()
  try {
    secondResult = await new secondRunnerImport.TestRunner({context}).run()
  } finally {
    fakeTimers.restore()
  }
  console.log([
    `same=${context === secondImport.defaultTestContext}`,
    `matcher=${context.expect === secondImport.defaultTestContext.expect}`,
    `first=${firstResult.status}`,
    `plain=${standalonePlainArity}`,
    `row=${standaloneRowArguments?.join(":")}`,
    `deadline=${secondResult.status}:${secondResult.tests[0]?.error?.message.startsWith("Timed out after 5ms")}`,
    `events=${eventTypes.includes("attempt:finish") && eventTypes.includes("run:finish")}`
  ].join("|"))
} else if (mode === "incompatible-copies") {
  const order = forcedString(process.argv[3], "import order")
  const packagePath = forcedString(process.argv[4], "package path")

  try {
    if (order === "package-first") {
      await import(packagePath)
      const fixtureImport = await import("./testing-package-0.0.1-copy.js")
      void fixtureImport.defaultTestContext
    } else if (order === "fixture-first") {
      const fixtureImport = await import("./testing-package-0.0.1-copy.js")
      void fixtureImport.defaultTestContext
      await import(packagePath)
    } else {
      throw new Error(`Unsupported import order: ${order}`)
    }
    throw new Error("Incompatible package copies loaded without an error")
  } catch (error) {
    if (!(error instanceof Error)) throw error

    console.log(error.message)
  }
} else if (mode === "runner-behavior") {
  const facadeImport = await import(facadePath)
  const packageImport = await import("@velocious/testing")
  const runnerImport = await import("../../../../src/testing/test-runner.js")
  const configurationImport = await import("../../../helpers/testing-configuration.js")
  const calls = []

  packageImport.defaultTestContext.reset({config: true})
  await facadeImport.describe("package behavior", () => {
    packageImport.it.skip("skipped test", () => calls.push("skipped test"))
    packageImport.it.todo("todo test")
    packageImport.describe.skip("skipped suite", () => {
      facadeImport.it("skipped child", () => calls.push("skipped child"))
    })
    facadeImport.describe.todo("todo suite", () => {
      packageImport.it("todo child", () => calls.push("todo child"))
    })
    packageImport.it.each([[1, 2], [3, 4]])("row %d + %d", {type: "table"}, (left, right, testArgs) => {
      calls.push(`row:${left}:${right}:${testArgs.type}`)
    })
    facadeImport.it("plain", {type: "plain"}, function (testArgs) {
      calls.push(`plain:${arguments.length}:${testArgs.type}`)
    })
  })
  const testRunner = new runnerImport.default({
    configuration: configurationImport.default(),
    testFiles: []
  })
  const originalConsoleLog = console.log

  console.log = () => {}
  try {
    testRunner.analyzeDeclarations()
    await testRunner.run()
  } finally {
    console.log = originalConsoleLog
  }
  originalConsoleLog(JSON.stringify({
    calls,
    failed: testRunner.getFailedTests(),
    successful: testRunner.getSuccessfulTests(),
    total: testRunner.getTestsCount()
  }))
} else if (mode === "duplicate-mixed-declarations") {
  const facadeImport = await import(facadePath)
  const packageImport = await import("@velocious/testing")

  packageImport.defaultTestContext.reset({config: true})
  try {
    await facadeImport.describe("duplicates", () => {
      facadeImport.it("same name", () => {})
      packageImport.it("same name", () => {})
    })
    throw new Error("Mixed duplicate declaration was accepted")
  } catch (error) {
    if (!(error instanceof Error)) throw error
    console.log(error.message)
  }
} else {
  throw new Error(`Unsupported probe mode: ${mode}`)
}
