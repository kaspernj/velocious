// @ts-check
import { randomUUID } from "node:crypto";
import configurationResolver from "../configuration-resolver.js";
import { currentBackgroundJobProducerProof } from "./execution-context.js";
import PlatformVelociousJob from "./platform-job.js";
import { cancelScheduledBackgroundJobForConfiguration, enqueueBackgroundJobForConfiguration, replaceScheduledBackgroundJobForConfiguration } from "./runtime.js";
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
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9iLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9qb2IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFFeEMsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLEVBQUUsaUNBQWlDLEVBQUUsTUFBTSx3QkFBd0IsQ0FBQTtBQUMxRSxPQUFPLG9CQUFvQixNQUFNLG1CQUFtQixDQUFBO0FBQ3BELE9BQU8sRUFDTCw0Q0FBNEMsRUFDNUMsb0NBQW9DLEVBQ3BDLDZDQUE2QyxFQUM5QyxNQUFNLGNBQWMsQ0FBQTtBQUVyQjs7Ozs7O0dBTUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLFlBQWEsU0FBUSxvQkFBb0I7SUFDNUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLEdBQUcsSUFBSTtRQUMvQixNQUFNLGFBQWEsR0FBRyxNQUFNLHFCQUFxQixFQUFFLENBQUE7UUFDbkQsTUFBTSxFQUFDLE9BQU8sRUFBRSxVQUFVLEVBQUMsR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDN0QsTUFBTSxhQUFhLEdBQUcsaUNBQWlDLEVBQUUsQ0FBQTtRQUV6RCxPQUFPLE1BQU0sb0NBQW9DLENBQUM7WUFDaEQsYUFBYTtZQUNiLFFBQVEsRUFBRSxJQUFJO1lBQ2QsT0FBTztZQUNQLFVBQVU7WUFDVixhQUFhO1lBQ2Isb0JBQW9CLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUztTQUMvRCxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDbEQsTUFBTSxhQUFhLEdBQUcsTUFBTSxxQkFBcUIsRUFBRSxDQUFBO1FBQ25ELE1BQU0sYUFBYSxHQUFHLGlDQUFpQyxFQUFFLENBQUE7UUFFekQsT0FBTyxNQUFNLG9DQUFvQyxDQUFDO1lBQ2hELGFBQWE7WUFDYixRQUFRLEVBQUUsSUFBSTtZQUNkLE9BQU8sRUFBRSxJQUFJO1lBQ2IsVUFBVSxFQUFFLE9BQU87WUFDbkIsYUFBYTtZQUNiLG9CQUFvQixFQUFFLGFBQWEsQ0FBQyxDQUFDLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVM7U0FDL0QsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDeEQsTUFBTSxhQUFhLEdBQUcsTUFBTSxxQkFBcUIsRUFBRSxDQUFBO1FBRW5ELE9BQU8sTUFBTSw2Q0FBNkMsQ0FBQyxFQUFDLGFBQWEsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO0lBQzlJLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsV0FBVztRQUN0QyxNQUFNLGFBQWEsR0FBRyxNQUFNLHFCQUFxQixFQUFFLENBQUE7UUFFbkQsT0FBTyxNQUFNLDRDQUE0QyxDQUFDLEVBQUMsYUFBYSxFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUE7SUFDekYsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuXG5pbXBvcnQgY29uZmlndXJhdGlvblJlc29sdmVyIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLXJlc29sdmVyLmpzXCJcbmltcG9ydCB7IGN1cnJlbnRCYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZiB9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0LmpzXCJcbmltcG9ydCBQbGF0Zm9ybVZlbG9jaW91c0pvYiBmcm9tIFwiLi9wbGF0Zm9ybS1qb2IuanNcIlxuaW1wb3J0IHtcbiAgY2FuY2VsU2NoZWR1bGVkQmFja2dyb3VuZEpvYkZvckNvbmZpZ3VyYXRpb24sXG4gIGVucXVldWVCYWNrZ3JvdW5kSm9iRm9yQ29uZmlndXJhdGlvbixcbiAgcmVwbGFjZVNjaGVkdWxlZEJhY2tncm91bmRKb2JGb3JDb25maWd1cmF0aW9uXG59IGZyb20gXCIuL3J1bnRpbWUuanNcIlxuXG4vKipcbiAqIE5vZGUgYmFja2dyb3VuZC1qb2IgZW50cnkuIEl0IHByZXNlcnZlcyBsYXp5IGNvbmZpZ3VyYXRpb24gZGlzY292ZXJ5IGZvclxuICogZnJlc2ggcHJvZHVjZXIgcHJvY2Vzc2VzIHdoaWxlIHRoZSBleHBsaWNpdCBwbGF0Zm9ybSBlbnRyeSBzdGF5cyBmcmVlIG9mXG4gKiBOb2RlLW9ubHkgY29uZmlndXJhdGlvbiByZXNvbHV0aW9uLlxuICogQHRlbXBsYXRlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtUQXJncz1bXV1cbiAqIEBhdWdtZW50cyB7UGxhdGZvcm1WZWxvY2lvdXNKb2I8VEFyZ3M+fVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNKb2IgZXh0ZW5kcyBQbGF0Zm9ybVZlbG9jaW91c0pvYiB7XG4gIC8qKlxuICAgKiBSdW5zIHBlcmZvcm0gbGF0ZXIuXG4gICAqIEBwYXJhbSB7Li4uUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MgLSBKb2IgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcGVyZm9ybUxhdGVyKC4uLmFyZ3MpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgICBjb25zdCB7am9iQXJncywgam9iT3B0aW9uc30gPSB0aGlzLl9zcGxpdEFyZ3NBbmRPcHRpb25zKGFyZ3MpXG4gICAgY29uc3QgcHJvZHVjZXJQcm9vZiA9IGN1cnJlbnRCYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZigpXG5cbiAgICByZXR1cm4gYXdhaXQgZW5xdWV1ZUJhY2tncm91bmRKb2JGb3JDb25maWd1cmF0aW9uKHtcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBKb2JDbGFzczogdGhpcyxcbiAgICAgIGpvYkFyZ3MsXG4gICAgICBqb2JPcHRpb25zLFxuICAgICAgcHJvZHVjZXJQcm9vZixcbiAgICAgIHByb2R1Y2VySW52b2NhdGlvbklkOiBwcm9kdWNlclByb29mID8gcmFuZG9tVVVJRCgpIDogdW5kZWZpbmVkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcmZvcm0gbGF0ZXIgd2l0aCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwZXJmb3JtTGF0ZXJXaXRoT3B0aW9ucyh7YXJncywgb3B0aW9uc30pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgICBjb25zdCBwcm9kdWNlclByb29mID0gY3VycmVudEJhY2tncm91bmRKb2JQcm9kdWNlclByb29mKClcblxuICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQmFja2dyb3VuZEpvYkZvckNvbmZpZ3VyYXRpb24oe1xuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIEpvYkNsYXNzOiB0aGlzLFxuICAgICAgam9iQXJnczogYXJncyxcbiAgICAgIGpvYk9wdGlvbnM6IG9wdGlvbnMsXG4gICAgICBwcm9kdWNlclByb29mLFxuICAgICAgcHJvZHVjZXJJbnZvY2F0aW9uSWQ6IHByb2R1Y2VyUHJvb2YgPyByYW5kb21VVUlEKCkgOiB1bmRlZmluZWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVwbGFjZXMgdGhpcyBqb2IgY2xhc3MncyBxdWV1ZWQgb3duZXIgZm9yIGEgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGFjZVNjaGVkdWxlZCh7c2NoZWR1bGVLZXksIGFyZ3MsIG9wdGlvbnN9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IGF3YWl0IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVwbGFjZVNjaGVkdWxlZEJhY2tncm91bmRKb2JGb3JDb25maWd1cmF0aW9uKHtjb25maWd1cmF0aW9uLCBKb2JDbGFzczogdGhpcywgc2NoZWR1bGVLZXksIGpvYkFyZ3M6IGFyZ3MsIGpvYk9wdGlvbnM6IG9wdGlvbnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgb3IgZGV0YWNoZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjYW5jZWxTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgY29uZmlndXJhdGlvblJlc29sdmVyKClcblxuICAgIHJldHVybiBhd2FpdCBjYW5jZWxTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iRm9yQ29uZmlndXJhdGlvbih7Y29uZmlndXJhdGlvbiwgc2NoZWR1bGVLZXl9KVxuICB9XG59XG4iXX0=