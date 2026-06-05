// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Cli from "../../src/cli/index.js"
import BaseCommand from "../../src/cli/base-command.js"

class FirstCommand extends BaseCommand {
  /** @returns {Promise<string>} */
  async execute() {
    const state = /** @type {{closeCalls: number, executions: string[][]}} */ (this.getConfiguration().state)

    state.executions.push([...this.processArgs])

    return "first"
  }
}

class SecondCommand extends BaseCommand {
  /** @returns {Promise<string>} */
  async execute() {
    const state = /** @type {{closeCalls: number, executions: string[][]}} */ (this.getConfiguration().state)

    state.executions.push([...this.processArgs])
    expect(state.closeCalls).toEqual(1)

    return "second"
  }
}

class FailingCommand extends BaseCommand {
  /** @returns {Promise<void>} */
  async execute() {
    throw new Error("command failed")
  }
}

class FakeEnvironmentHandler {
  /**
   * @param {object} args - Args.
   * @returns {void} - No return value.
   */
  setArgs(args) {
    this.args = args
  }

  /**
   * @param {object} configuration - Configuration.
   * @returns {void} - No return value.
   */
  setConfiguration(configuration) {
    this.configuration = configuration
  }

  /** @returns {Promise<Array<{name: string}>>} - Available commands. */
  async findCommands() {
    return [{name: "failing"}, {name: "first"}, {name: "second"}]
  }

  /**
   * @param {object} args - Options object.
   * @param {string[]} args.commandParts - Command parts.
   * @returns {Promise<typeof BaseCommand>} - Command class.
   */
  async requireCommand({commandParts}) {
    const commandName = commandParts.join(":")

    if (commandName == "first") return FirstCommand
    if (commandName == "second") return SecondCommand
    if (commandName == "failing") return FailingCommand

    throw new Error(`Unknown command: ${commandName}`)
  }
}

/**
 * @param {object} [args] - Options object.
 * @param {Record<string, unknown>} [args.currentConnections] - Current database connections.
 * @returns {{closeDatabaseConnections: () => Promise<void>, getCurrentConnections: () => Record<string, unknown>, getEnvironmentHandler: () => FakeEnvironmentHandler, state: {closeCalls: number, executions: string[][]}}} - Fake configuration.
 */
function createConfiguration(args = {}) {
  const environmentHandler = new FakeEnvironmentHandler()
  const configuration = {
    closeDatabaseConnections: async () => {
      configuration.state.closeCalls += 1
    },
    getCurrentConnections: () => args.currentConnections || {},
    getEnvironmentHandler: () => environmentHandler,
    state: {
      closeCalls: 0,
      executions: []
    }
  }

  return configuration
}

describe("Cli - Multiple commands", () => {
  it("runs multiple commands sequentially and closes connections after each command", async () => {
    const configuration = createConfiguration()
    const cli = new Cli({
      configuration: /** @type {import("../../src/configuration.js").default} */ (configuration),
      processArgs: ["first", "second"],
      testing: true
    })

    const result = await cli.execute()

    expect(result).toEqual("second")
    expect(configuration.state.executions).toEqual([["first"], ["second"]])
    expect(configuration.state.closeCalls).toEqual(2)
  })

  it("closes connections after a single command", async () => {
    const configuration = createConfiguration()
    const cli = new Cli({
      configuration: /** @type {import("../../src/configuration.js").default} */ (configuration),
      processArgs: ["first"],
      testing: true
    })

    const result = await cli.execute()

    expect(result).toEqual("first")
    expect(configuration.state.executions).toEqual([["first"]])
    expect(configuration.state.closeCalls).toEqual(1)
  })

  it("does not close an existing connection context after a nested command", async () => {
    const configuration = createConfiguration({currentConnections: {default: {}}})
    const cli = new Cli({
      configuration: /** @type {import("../../src/configuration.js").default} */ (configuration),
      processArgs: ["first"],
      testing: true
    })

    const result = await cli.execute()

    expect(result).toEqual("first")
    expect(configuration.state.executions).toEqual([["first"]])
    expect(configuration.state.closeCalls).toEqual(0)
  })

  it("closes connections when a command fails", async () => {
    const configuration = createConfiguration()
    const cli = new Cli({
      configuration: /** @type {import("../../src/configuration.js").default} */ (configuration),
      processArgs: ["failing"],
      testing: true
    })

    try {
      await cli.execute()
      throw new Error("Expected command to fail")
    } catch (error) {
      expect(error.message).toEqual("command failed")
    }

    expect(configuration.state.closeCalls).toEqual(1)
  })

  it("ignores leading global flags before the first command", async () => {
    const configuration = createConfiguration()
    const cli = new Cli({
      configuration: /** @type {import("../../src/configuration.js").default} */ (configuration),
      parsedProcessArgs: {debug: true},
      processArgs: ["--debug", "first", "second"],
      testing: true
    })

    await cli.execute()

    expect(configuration.state.executions).toEqual([["first"], ["second"]])
  })
})
