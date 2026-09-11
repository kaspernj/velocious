// @ts-check
import { randomUUID } from "node:crypto";
import configurationResolver from "../configuration-resolver.js";
import { currentBackgroundJobProducerProof } from "./execution-context.js";
import PlatformVelociousJob from "./platform-job.js";
import { cancelScheduledBackgroundJobForConfiguration, enqueueBackgroundJobForConfiguration, getScheduledBackgroundJobForConfiguration, replaceScheduledBackgroundJobForConfiguration, wakeScheduledBackgroundJobForConfiguration } from "./runtime.js";
/**
 * Node background-job entry. It preserves lazy configuration discovery for
 * fresh producer processes while the explicit platform entry stays free of
 * Node-only configuration resolution.
 * @template {Array<ReturnType<typeof JSON.parse>>} [TArgs=[]]
 * @augments {PlatformVelociousJob<TArgs>}
 */
export default class VelociousJob extends PlatformVelociousJob {
    /**
     * Runs perform later.
     * @param {...ReturnType<typeof JSON.parse>} args - Job args.
     * @returns {Promise<string>} - Job id.
     */
    static async performLater(...args) {
        const configuration = await configurationResolver();
        const { jobArgs, jobOptions } = this._splitArgsAndOptions(args);
        const producerProof = currentBackgroundJobProducerProof();
        return await enqueueBackgroundJobForConfiguration({
            configuration,
            JobClass: this,
            jobArgs,
            jobOptions,
            producerProof,
            producerInvocationId: producerProof ? randomUUID() : undefined
        });
    }
    /**
     * Runs perform later with options.
     * @param {object} args - Options.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<string>} - Job id.
     */
    static async performLaterWithOptions({ args, options }) {
        const configuration = await configurationResolver();
        const producerProof = currentBackgroundJobProducerProof();
        return await enqueueBackgroundJobForConfiguration({
            configuration,
            JobClass: this,
            jobArgs: args,
            jobOptions: options,
            producerProof,
            producerInvocationId: producerProof ? randomUUID() : undefined
        });
    }
    /**
     * Atomically replaces this job class's queued owner for a stable schedule key.
     * @param {object} args - Options.
     * @param {string} args.scheduleKey - Stable logical schedule key.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    static async replaceScheduled({ scheduleKey, args, options }) {
        const configuration = await configurationResolver();
        return await replaceScheduledBackgroundJobForConfiguration({ configuration, JobClass: this, scheduleKey, jobArgs: args, jobOptions: options });
    }
    /**
     * Cancels or detaches the current owner of a stable schedule key.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    static async cancelScheduled(scheduleKey) {
        const configuration = await configurationResolver();
        return await cancelScheduledBackgroundJobForConfiguration({ configuration, scheduleKey });
    }
    /**
     * Reads current ownership and optional terminal history for a stable key.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @param {{includeLatestTerminal?: boolean}} [options] - Lookup options.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized stable schedule jobs.
     */
    static async getScheduledJob(scheduleKey, options = {}) {
        const configuration = await configurationResolver();
        return await getScheduledBackgroundJobForConfiguration({ configuration, scheduleKey, ...options });
    }
    /**
     * Expedites a future queued owner without creating another job.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobWakeResult>} - Wake result.
     */
    static async wakeScheduled(scheduleKey) {
        const configuration = await configurationResolver();
        return await wakeScheduledBackgroundJobForConfiguration({ configuration, scheduleKey });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9iLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9qb2IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFFeEMsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLEVBQUUsaUNBQWlDLEVBQUUsTUFBTSx3QkFBd0IsQ0FBQTtBQUMxRSxPQUFPLG9CQUFvQixNQUFNLG1CQUFtQixDQUFBO0FBQ3BELE9BQU8sRUFDTCw0Q0FBNEMsRUFDNUMsb0NBQW9DLEVBQ3BDLHlDQUF5QyxFQUN6Qyw2Q0FBNkMsRUFDN0MsMENBQTBDLEVBQzNDLE1BQU0sY0FBYyxDQUFBO0FBRXJCOzs7Ozs7R0FNRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sWUFBYSxTQUFRLG9CQUFvQjtJQUM1RDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsR0FBRyxJQUFJO1FBQy9CLE1BQU0sYUFBYSxHQUFHLE1BQU0scUJBQXFCLEVBQUUsQ0FBQTtRQUNuRCxNQUFNLEVBQUMsT0FBTyxFQUFFLFVBQVUsRUFBQyxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM3RCxNQUFNLGFBQWEsR0FBRyxpQ0FBaUMsRUFBRSxDQUFBO1FBRXpELE9BQU8sTUFBTSxvQ0FBb0MsQ0FBQztZQUNoRCxhQUFhO1lBQ2IsUUFBUSxFQUFFLElBQUk7WUFDZCxPQUFPO1lBQ1AsVUFBVTtZQUNWLGFBQWE7WUFDYixvQkFBb0IsRUFBRSxhQUFhLENBQUMsQ0FBQyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTO1NBQy9ELENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLHVCQUF1QixDQUFDLEVBQUMsSUFBSSxFQUFFLE9BQU8sRUFBQztRQUNsRCxNQUFNLGFBQWEsR0FBRyxNQUFNLHFCQUFxQixFQUFFLENBQUE7UUFDbkQsTUFBTSxhQUFhLEdBQUcsaUNBQWlDLEVBQUUsQ0FBQTtRQUV6RCxPQUFPLE1BQU0sb0NBQW9DLENBQUM7WUFDaEQsYUFBYTtZQUNiLFFBQVEsRUFBRSxJQUFJO1lBQ2QsT0FBTyxFQUFFLElBQUk7WUFDYixVQUFVLEVBQUUsT0FBTztZQUNuQixhQUFhO1lBQ2Isb0JBQW9CLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUztTQUMvRCxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxXQUFXLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBQztRQUN4RCxNQUFNLGFBQWEsR0FBRyxNQUFNLHFCQUFxQixFQUFFLENBQUE7UUFFbkQsT0FBTyxNQUFNLDZDQUE2QyxDQUFDLEVBQUMsYUFBYSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7SUFDOUksQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQyxXQUFXO1FBQ3RDLE1BQU0sYUFBYSxHQUFHLE1BQU0scUJBQXFCLEVBQUUsQ0FBQTtRQUVuRCxPQUFPLE1BQU0sNENBQTRDLENBQUMsRUFBQyxhQUFhLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtJQUN6RixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQyxXQUFXLEVBQUUsT0FBTyxHQUFHLEVBQUU7UUFDcEQsTUFBTSxhQUFhLEdBQUcsTUFBTSxxQkFBcUIsRUFBRSxDQUFBO1FBRW5ELE9BQU8sTUFBTSx5Q0FBeUMsQ0FBQyxFQUFDLGFBQWEsRUFBRSxXQUFXLEVBQUUsR0FBRyxPQUFPLEVBQUMsQ0FBQyxDQUFBO0lBQ2xHLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsV0FBVztRQUNwQyxNQUFNLGFBQWEsR0FBRyxNQUFNLHFCQUFxQixFQUFFLENBQUE7UUFFbkQsT0FBTyxNQUFNLDBDQUEwQyxDQUFDLEVBQUMsYUFBYSxFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUE7SUFDdkYsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuXG5pbXBvcnQgY29uZmlndXJhdGlvblJlc29sdmVyIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLXJlc29sdmVyLmpzXCJcbmltcG9ydCB7IGN1cnJlbnRCYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZiB9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0LmpzXCJcbmltcG9ydCBQbGF0Zm9ybVZlbG9jaW91c0pvYiBmcm9tIFwiLi9wbGF0Zm9ybS1qb2IuanNcIlxuaW1wb3J0IHtcbiAgY2FuY2VsU2NoZWR1bGVkQmFja2dyb3VuZEpvYkZvckNvbmZpZ3VyYXRpb24sXG4gIGVucXVldWVCYWNrZ3JvdW5kSm9iRm9yQ29uZmlndXJhdGlvbixcbiAgZ2V0U2NoZWR1bGVkQmFja2dyb3VuZEpvYkZvckNvbmZpZ3VyYXRpb24sXG4gIHJlcGxhY2VTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iRm9yQ29uZmlndXJhdGlvbixcbiAgd2FrZVNjaGVkdWxlZEJhY2tncm91bmRKb2JGb3JDb25maWd1cmF0aW9uXG59IGZyb20gXCIuL3J1bnRpbWUuanNcIlxuXG4vKipcbiAqIE5vZGUgYmFja2dyb3VuZC1qb2IgZW50cnkuIEl0IHByZXNlcnZlcyBsYXp5IGNvbmZpZ3VyYXRpb24gZGlzY292ZXJ5IGZvclxuICogZnJlc2ggcHJvZHVjZXIgcHJvY2Vzc2VzIHdoaWxlIHRoZSBleHBsaWNpdCBwbGF0Zm9ybSBlbnRyeSBzdGF5cyBmcmVlIG9mXG4gKiBOb2RlLW9ubHkgY29uZmlndXJhdGlvbiByZXNvbHV0aW9uLlxuICogQHRlbXBsYXRlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtUQXJncz1bXV1cbiAqIEBhdWdtZW50cyB7UGxhdGZvcm1WZWxvY2lvdXNKb2I8VEFyZ3M+fVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNKb2IgZXh0ZW5kcyBQbGF0Zm9ybVZlbG9jaW91c0pvYiB7XG4gIC8qKlxuICAgKiBSdW5zIHBlcmZvcm0gbGF0ZXIuXG4gICAqIEBwYXJhbSB7Li4uUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MgLSBKb2IgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcGVyZm9ybUxhdGVyKC4uLmFyZ3MpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgICBjb25zdCB7am9iQXJncywgam9iT3B0aW9uc30gPSB0aGlzLl9zcGxpdEFyZ3NBbmRPcHRpb25zKGFyZ3MpXG4gICAgY29uc3QgcHJvZHVjZXJQcm9vZiA9IGN1cnJlbnRCYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZigpXG5cbiAgICByZXR1cm4gYXdhaXQgZW5xdWV1ZUJhY2tncm91bmRKb2JGb3JDb25maWd1cmF0aW9uKHtcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBKb2JDbGFzczogdGhpcyxcbiAgICAgIGpvYkFyZ3MsXG4gICAgICBqb2JPcHRpb25zLFxuICAgICAgcHJvZHVjZXJQcm9vZixcbiAgICAgIHByb2R1Y2VySW52b2NhdGlvbklkOiBwcm9kdWNlclByb29mID8gcmFuZG9tVVVJRCgpIDogdW5kZWZpbmVkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcmZvcm0gbGF0ZXIgd2l0aCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwZXJmb3JtTGF0ZXJXaXRoT3B0aW9ucyh7YXJncywgb3B0aW9uc30pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgICBjb25zdCBwcm9kdWNlclByb29mID0gY3VycmVudEJhY2tncm91bmRKb2JQcm9kdWNlclByb29mKClcblxuICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQmFja2dyb3VuZEpvYkZvckNvbmZpZ3VyYXRpb24oe1xuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIEpvYkNsYXNzOiB0aGlzLFxuICAgICAgam9iQXJnczogYXJncyxcbiAgICAgIGpvYk9wdGlvbnM6IG9wdGlvbnMsXG4gICAgICBwcm9kdWNlclByb29mLFxuICAgICAgcHJvZHVjZXJJbnZvY2F0aW9uSWQ6IHByb2R1Y2VyUHJvb2YgPyByYW5kb21VVUlEKCkgOiB1bmRlZmluZWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVwbGFjZXMgdGhpcyBqb2IgY2xhc3MncyBxdWV1ZWQgb3duZXIgZm9yIGEgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGFjZVNjaGVkdWxlZCh7c2NoZWR1bGVLZXksIGFyZ3MsIG9wdGlvbnN9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IGF3YWl0IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVwbGFjZVNjaGVkdWxlZEJhY2tncm91bmRKb2JGb3JDb25maWd1cmF0aW9uKHtjb25maWd1cmF0aW9uLCBKb2JDbGFzczogdGhpcywgc2NoZWR1bGVLZXksIGpvYkFyZ3M6IGFyZ3MsIGpvYk9wdGlvbnM6IG9wdGlvbnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgb3IgZGV0YWNoZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjYW5jZWxTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgY29uZmlndXJhdGlvblJlc29sdmVyKClcblxuICAgIHJldHVybiBhd2FpdCBjYW5jZWxTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iRm9yQ29uZmlndXJhdGlvbih7Y29uZmlndXJhdGlvbiwgc2NoZWR1bGVLZXl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGN1cnJlbnQgb3duZXJzaGlwIGFuZCBvcHRpb25hbCB0ZXJtaW5hbCBoaXN0b3J5IGZvciBhIHN0YWJsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHt7aW5jbHVkZUxhdGVzdFRlcm1pbmFsPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIExvb2t1cCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTY2hlZHVsZWRMb29rdXBSZXN1bHQ+fSAtIE5vcm1hbGl6ZWQgc3RhYmxlIHNjaGVkdWxlIGpvYnMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZ2V0U2NoZWR1bGVkSm9iKHNjaGVkdWxlS2V5LCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgY29uZmlndXJhdGlvblJlc29sdmVyKClcblxuICAgIHJldHVybiBhd2FpdCBnZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iRm9yQ29uZmlndXJhdGlvbih7Y29uZmlndXJhdGlvbiwgc2NoZWR1bGVLZXksIC4uLm9wdGlvbnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIEV4cGVkaXRlcyBhIGZ1dHVyZSBxdWV1ZWQgb3duZXIgd2l0aG91dCBjcmVhdGluZyBhbm90aGVyIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JXYWtlUmVzdWx0Pn0gLSBXYWtlIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB3YWtlU2NoZWR1bGVkKHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IGF3YWl0IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG5cbiAgICByZXR1cm4gYXdhaXQgd2FrZVNjaGVkdWxlZEJhY2tncm91bmRKb2JGb3JDb25maWd1cmF0aW9uKHtjb25maWd1cmF0aW9uLCBzY2hlZHVsZUtleX0pXG4gIH1cbn1cbiJdfQ==