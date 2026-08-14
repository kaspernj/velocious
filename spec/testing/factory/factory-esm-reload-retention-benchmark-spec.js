// @ts-check

import {
  FIXTURE_FILE_COUNT,
  REPORT_PREFIX,
  applyEdit,
  childCompletedSuccessfully,
  dependencyTagAt,
  parseChildReport,
  planEpochs,
  topLevelTagAt,
  validateBenchmarkRows,
  writeFixture
} from "../../../benchmark/support/factory-esm-reload-retention.js"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { afterEach, beforeEach, describe, expect, it } from "../../../src/testing/test.js"
import os from "node:os"
import path from "node:path"

describe("Factory ESM reload retention benchmark control flow", () => {
  /** @type {string} */
  let directory

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "factory-benchmark-spec-"))
  })

  afterEach(async () => {
    await rm(directory, {recursive: true, force: true})
  })

  it("plans deterministic child epochs that never exceed capacity", () => {
    expect(planEpochs({totalReloads: 100, capacity: 100})).toEqual([100])
    expect(planEpochs({totalReloads: 100, capacity: 33})).toEqual([33, 33, 33, 1])
    expect(planEpochs({totalReloads: 1000, capacity: 100})).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100, 100])
    expect(planEpochs({totalReloads: 1000, capacity: 300})).toEqual([300, 300, 300, 100])
  })

  it("derives deterministic edit tags from the reload index", () => {
    expect(topLevelTagAt(0)).toEqual("top-0")
    expect(topLevelTagAt(2)).toEqual("top-0")
    expect(topLevelTagAt(3)).toEqual("top-3")
    expect(dependencyTagAt(0)).toEqual("dep-0")
    expect(dependencyTagAt(3)).toEqual("dep-0")
    expect(dependencyTagAt(4)).toEqual("dep-4")
  })

  it("writes a fixture with the advertised number of definition files", async () => {
    await writeFixture(directory)

    expect(FIXTURE_FILE_COUNT).toEqual(3)
    expect(await readFile(path.join(directory, "a-helper.js"), "utf8")).toMatch(/dep-0/)
    expect(await readFile(path.join(directory, "b-definitions.js"), "utf8")).toMatch(/top-0/)
    expect(await readFile(path.join(directory, "z-definitions.js"), "utf8")).toMatch(/gadget/)
  })

  it("applies a dependency-only edit without touching the top-level file", async () => {
    await writeFixture(directory)

    await applyEdit({directory, editIndex: 4})

    const helper = await readFile(path.join(directory, "a-helper.js"), "utf8")
    const topLevel = await readFile(path.join(directory, "b-definitions.js"), "utf8")

    expect(helper).toMatch(/dep-4/)
    expect(topLevel).toMatch(/top-0/)
  })

  it("applies a top-level edit without touching the dependency file", async () => {
    await writeFixture(directory)

    await applyEdit({directory, editIndex: 3})

    const helper = await readFile(path.join(directory, "a-helper.js"), "utf8")
    const topLevel = await readFile(path.join(directory, "b-definitions.js"), "utf8")

    expect(topLevel).toMatch(/top-3/)
    expect(helper).toMatch(/dep-0/)
  })

  it("applies both edits on an aligned reload index", async () => {
    await writeFixture(directory)

    const edits = await applyEdit({directory, editIndex: 12})

    expect(edits).toEqual(["topLevel", "dependency"])
    expect(await readFile(path.join(directory, "b-definitions.js"), "utf8")).toMatch(/top-12/)
    expect(await readFile(path.join(directory, "a-helper.js"), "utf8")).toMatch(/dep-12/)
  })

  it("extracts the child report from stdout and ignores unrelated lines", () => {
    const output = [
      "some noise",
      `${REPORT_PREFIX} {"reportKind":"factory-esm-reload-retention","completedReloads":33,"importAttempts":99}`,
      "trailing output"
    ].join("\n")
    const report = parseChildReport(output)

    expect(report).not.toBeNull()
    expect(report.completedReloads).toEqual(33)
    expect(report.importAttempts).toEqual(99)
    expect(parseChildReport("no report here")).toBeNull()
  })

  it("rejects malformed and duplicate child reports", () => {
    expect(parseChildReport(`${REPORT_PREFIX} not-json`)).toBeNull()
    expect(parseChildReport(`${REPORT_PREFIX} {"reportKind":"wrong"}`)).toBeNull()
    expect(parseChildReport([
      `${REPORT_PREFIX} {"reportKind":"factory-esm-reload-retention"}`,
      `${REPORT_PREFIX} {"reportKind":"factory-esm-reload-retention"}`
    ].join("\n"))).toBeNull()
  })

  it("requires a zero exit code, no signal, and one valid report from every child", () => {
    const report = {reportKind: "factory-esm-reload-retention"}

    expect(childCompletedSuccessfully({code: 0, report, signal: null})).toEqual(true)
    expect(childCompletedSuccessfully({code: 1, report, signal: null})).toEqual(false)
    expect(childCompletedSuccessfully({code: 0, report, signal: "SIGTERM"})).toEqual(false)
    expect(childCompletedSuccessfully({code: 0, report: null, signal: null})).toEqual(false)
  })

  it("accepts exactly the deterministic eight-row benchmark matrix", () => {
    const rows = benchmarkRows()

    expect(validateBenchmarkRows(rows)).toEqual({dependencyVisibilityAcrossRecycle: true, supervisedWithinBudget: true})
  })

  it("rejects missing, duplicate, incomplete, or stale-visibility matrix rows", () => {
    const missing = benchmarkRows()
    missing.pop()
    expect(() => validateBenchmarkRows(missing)).toThrow(/exactly 8 rows/)

    const duplicate = benchmarkRows()
    duplicate[7] = {...duplicate[0]}
    expect(() => validateBenchmarkRows(duplicate)).toThrow(/duplicate|missing/i)

    const incomplete = benchmarkRows()
    incomplete[0].completedReloads = 99
    expect(() => validateBenchmarkRows(incomplete)).toThrow(/completed reloads/i)

    const staleTopLevel = benchmarkRows()
    staleTopLevel.find((row) => row.mode === "single" && row.scenario === "edited").topLevelEditVisible = 0
    expect(() => validateBenchmarkRows(staleTopLevel)).toThrow(/top-level/i)

    const staleDependency = benchmarkRows()
    staleDependency.find((row) => row.mode === "supervised" && row.scenario === "edited").dependencyVisibilityAcrossRecycle = false
    expect(() => validateBenchmarkRows(staleDependency)).toThrow(/dependency/i)
  })
})

/** Builds a minimal valid matrix row for validator tests. */
function benchmarkRow({mode, reloads, scenario}) {
  const edited = scenario === "edited"
  const topLevelEditCount = edited ? Math.floor((reloads - 1) / 3) + 1 : 0

  return {
    completedReloads: reloads,
    dependencyVisibilityAcrossRecycle: mode === "supervised" && edited ? true : null,
    epochsWithinBudget: mode === "supervised" ? true : null,
    importAttempts: reloads * FIXTURE_FILE_COUNT,
    mode,
    ok: true,
    reloads,
    scenario,
    supervised: mode === "supervised",
    topLevelEditCount,
    topLevelEditVisible: topLevelEditCount
  }
}

/** Builds the complete expected 2 x 2 x 2 benchmark matrix. */
function benchmarkRows() {
  return ["single", "supervised"].flatMap((mode) => (
    ["unchanged", "edited"].flatMap((scenario) => (
      [100, 1000].map((reloads) => benchmarkRow({mode, reloads, scenario}))
    ))
  ))
}
