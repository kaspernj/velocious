// @ts-check

import VelociousBackgroundJobsWebController from "./controller.js"
import {matchJobsApiPath, normalizeMountPrefix} from "./path-matcher.js"
import {registerJobsMount} from "./registry.js"

/**
 * Mountable read-only background-jobs dashboard API. Include it in a routes file
 * the way Sidekiq::Web is mounted in Rails:
 *
 * ```js
 * routes.draw((route) => {
 *   route.mount(VelociousBackgroundJobsApi, {
 *     at: "/velocious/jobs",
 *     authorize: async ({request, ability}) => { ... },
 *     accessTokens: [process.env.VELOCIOUS_JOBS_TOKEN]
 *   })
 * })
 * ```
 */
export default class VelociousBackgroundJobsApi {
  /**
   * Registers the jobs API under `at`. Implemented as a route-resolver hook so
   * the controller can live inside the velocious package rather than the host
   * app's `src/routes` directory. Invoked by the routing layer for each
   * `route.mount(...)` registration.
   * @param {object} args - Options.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} args.at - Mount path prefix (e.g. "/velocious/jobs").
   * @param {import("./registry.js").JobsMountOptions["authorize"]} [args.authorize] - Authorization callback.
   * @param {string[]} [args.accessTokens] - Accepted bearer tokens for cross-origin/native access.
   * @param {string[]} [args.allowedOrigins] - Allowed CORS origins for browser access.
   * @param {boolean} [args.redactArgs] - When true, job arguments are omitted from responses.
   * @param {string} [args.databaseIdentifier] - Database identifier the jobs store reads from.
   * @returns {void} - No return value.
   */
  static mountInto({accessTokens, allowedOrigins, at, authorize, configuration, databaseIdentifier, redactArgs}) {
    if (!configuration) throw new Error("No configuration given")

    const prefix = normalizeMountPrefix(at)

    registerJobsMount(configuration, prefix, {accessTokens, allowedOrigins, authorize, databaseIdentifier, redactArgs})

    configuration.addRouteResolverHook(({currentPath, request}) => {
      const match = matchJobsApiPath({method: request.httpMethod(), path: currentPath, prefix})

      if (!match) return null

      return {
        action: match.action,
        controller: "velociousBackgroundJobsWeb",
        controllerClass: VelociousBackgroundJobsWebController,
        params: {...match.params, velociousJobsMountAt: prefix}
      }
    })
  }
}
