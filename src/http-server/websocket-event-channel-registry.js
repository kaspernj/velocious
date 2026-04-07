// @ts-check

const DEFAULT_RETENTION_MS = 10 * 60 * 1000
const registries = new WeakMap()

/**
 * @param {import("../configuration.js").default} configuration - Configuration.
 * @returns {VelociousHttpServerWebsocketEventChannelRegistry} - Shared registry.
 */
export function websocketEventChannelRegistryForConfiguration(configuration) {
  let registry = registries.get(configuration)

  if (!registry) {
    registry = new VelociousHttpServerWebsocketEventChannelRegistry()
    registries.set(configuration, registry)
  }

  return registry
}

export default class VelociousHttpServerWebsocketEventChannelRegistry {
  constructor() {
    this.channelExpiries = new Map()
  }

  /**
   * @param {string} channel - Channel name.
   * @param {number} [retentionMs] - Retention window.
   * @returns {void} - No return value.
   */
  markInterested(channel, retentionMs = DEFAULT_RETENTION_MS) {
    this.channelExpiries.set(channel, Date.now() + retentionMs)
  }

  /**
   * @param {string} channel - Channel name.
   * @returns {boolean} - Whether the channel currently has replay interest.
   */
  isInterested(channel) {
    this.cleanupExpired()

    const expiresAt = this.channelExpiries.get(channel)

    return typeof expiresAt === "number" && expiresAt > Date.now()
  }

  /**
   * @returns {void} - No return value.
   */
  cleanupExpired() {
    const now = Date.now()

    for (const [channel, expiresAt] of this.channelExpiries.entries()) {
      if (expiresAt <= now) {
        this.channelExpiries.delete(channel)
      }
    }
  }
}
