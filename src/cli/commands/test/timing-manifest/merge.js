// @ts-check

import BaseCommand from "../../../base-command.js"

/** CLI command for merging complete rich test-profile shards into timing history. */
export default class TestTimingManifestMerge extends BaseCommand {
  /**
   * Runs execute.
   * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the merged manifest.
   */
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsTestTimingManifestMerge(this)
  }
}
