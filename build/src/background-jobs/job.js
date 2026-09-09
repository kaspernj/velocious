// @ts-check
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
        return await enqueueBackgroundJobForConfiguration({
            configuration,
            JobClass: this,
            jobArgs,
            jobOptions,
            producerProof: currentBackgroundJobProducerProof()
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
        return await enqueueBackgroundJobForConfiguration({
            configuration,
            JobClass: this,
            jobArgs: args,
            jobOptions: options,
            producerProof: currentBackgroundJobProducerProof()
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9iLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9qb2IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8scUJBQXFCLE1BQU0sOEJBQThCLENBQUE7QUFDaEUsT0FBTyxFQUFFLGlDQUFpQyxFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDMUUsT0FBTyxvQkFBb0IsTUFBTSxtQkFBbUIsQ0FBQTtBQUNwRCxPQUFPLEVBQ0wsNENBQTRDLEVBQzVDLG9DQUFvQyxFQUNwQyw2Q0FBNkMsRUFDOUMsTUFBTSxjQUFjLENBQUE7QUFFckI7Ozs7OztHQU1HO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxZQUFhLFNBQVEsb0JBQW9CO0lBQzVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxHQUFHLElBQUk7UUFDL0IsTUFBTSxhQUFhLEdBQUcsTUFBTSxxQkFBcUIsRUFBRSxDQUFBO1FBQ25ELE1BQU0sRUFBQyxPQUFPLEVBQUUsVUFBVSxFQUFDLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxDQUFBO1FBRTdELE9BQU8sTUFBTSxvQ0FBb0MsQ0FBQztZQUNoRCxhQUFhO1lBQ2IsUUFBUSxFQUFFLElBQUk7WUFDZCxPQUFPO1lBQ1AsVUFBVTtZQUNWLGFBQWEsRUFBRSxpQ0FBaUMsRUFBRTtTQUNuRCxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDbEQsTUFBTSxhQUFhLEdBQUcsTUFBTSxxQkFBcUIsRUFBRSxDQUFBO1FBRW5ELE9BQU8sTUFBTSxvQ0FBb0MsQ0FBQztZQUNoRCxhQUFhO1lBQ2IsUUFBUSxFQUFFLElBQUk7WUFDZCxPQUFPLEVBQUUsSUFBSTtZQUNiLFVBQVUsRUFBRSxPQUFPO1lBQ25CLGFBQWEsRUFBRSxpQ0FBaUMsRUFBRTtTQUNuRCxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxXQUFXLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBQztRQUN4RCxNQUFNLGFBQWEsR0FBRyxNQUFNLHFCQUFxQixFQUFFLENBQUE7UUFFbkQsT0FBTyxNQUFNLDZDQUE2QyxDQUFDLEVBQUMsYUFBYSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7SUFDOUksQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQyxXQUFXO1FBQ3RDLE1BQU0sYUFBYSxHQUFHLE1BQU0scUJBQXFCLEVBQUUsQ0FBQTtRQUVuRCxPQUFPLE1BQU0sNENBQTRDLENBQUMsRUFBQyxhQUFhLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtJQUN6RixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgeyBjdXJyZW50QmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2YgfSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dC5qc1wiXG5pbXBvcnQgUGxhdGZvcm1WZWxvY2lvdXNKb2IgZnJvbSBcIi4vcGxhdGZvcm0tam9iLmpzXCJcbmltcG9ydCB7XG4gIGNhbmNlbFNjaGVkdWxlZEJhY2tncm91bmRKb2JGb3JDb25maWd1cmF0aW9uLFxuICBlbnF1ZXVlQmFja2dyb3VuZEpvYkZvckNvbmZpZ3VyYXRpb24sXG4gIHJlcGxhY2VTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iRm9yQ29uZmlndXJhdGlvblxufSBmcm9tIFwiLi9ydW50aW1lLmpzXCJcblxuLyoqXG4gKiBOb2RlIGJhY2tncm91bmQtam9iIGVudHJ5LiBJdCBwcmVzZXJ2ZXMgbGF6eSBjb25maWd1cmF0aW9uIGRpc2NvdmVyeSBmb3JcbiAqIGZyZXNoIHByb2R1Y2VyIHByb2Nlc3NlcyB3aGlsZSB0aGUgZXhwbGljaXQgcGxhdGZvcm0gZW50cnkgc3RheXMgZnJlZSBvZlxuICogTm9kZS1vbmx5IGNvbmZpZ3VyYXRpb24gcmVzb2x1dGlvbi5cbiAqIEB0ZW1wbGF0ZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbVEFyZ3M9W11dXG4gKiBAYXVnbWVudHMge1BsYXRmb3JtVmVsb2Npb3VzSm9iPFRBcmdzPn1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSm9iIGV4dGVuZHMgUGxhdGZvcm1WZWxvY2lvdXNKb2Ige1xuICAvKipcbiAgICogUnVucyBwZXJmb3JtIGxhdGVyLlxuICAgKiBAcGFyYW0gey4uLlJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBlcmZvcm1MYXRlciguLi5hcmdzKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IGF3YWl0IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG4gICAgY29uc3Qge2pvYkFyZ3MsIGpvYk9wdGlvbnN9ID0gdGhpcy5fc3BsaXRBcmdzQW5kT3B0aW9ucyhhcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGVucXVldWVCYWNrZ3JvdW5kSm9iRm9yQ29uZmlndXJhdGlvbih7XG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgSm9iQ2xhc3M6IHRoaXMsXG4gICAgICBqb2JBcmdzLFxuICAgICAgam9iT3B0aW9ucyxcbiAgICAgIHByb2R1Y2VyUHJvb2Y6IGN1cnJlbnRCYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZigpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcmZvcm0gbGF0ZXIgd2l0aCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwZXJmb3JtTGF0ZXJXaXRoT3B0aW9ucyh7YXJncywgb3B0aW9uc30pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgY29uZmlndXJhdGlvblJlc29sdmVyKClcblxuICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQmFja2dyb3VuZEpvYkZvckNvbmZpZ3VyYXRpb24oe1xuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIEpvYkNsYXNzOiB0aGlzLFxuICAgICAgam9iQXJnczogYXJncyxcbiAgICAgIGpvYk9wdGlvbnM6IG9wdGlvbnMsXG4gICAgICBwcm9kdWNlclByb29mOiBjdXJyZW50QmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2YoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXBsYWNlcyB0aGlzIGpvYiBjbGFzcydzIHF1ZXVlZCBvd25lciBmb3IgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgY29uZmlndXJhdGlvblJlc29sdmVyKClcblxuICAgIHJldHVybiBhd2FpdCByZXBsYWNlU2NoZWR1bGVkQmFja2dyb3VuZEpvYkZvckNvbmZpZ3VyYXRpb24oe2NvbmZpZ3VyYXRpb24sIEpvYkNsYXNzOiB0aGlzLCBzY2hlZHVsZUtleSwgam9iQXJnczogYXJncywgam9iT3B0aW9uczogb3B0aW9uc30pXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyBvciBkZXRhY2hlcyB0aGUgY3VycmVudCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0Pn0gLSBDYW5jZWxsYXRpb24gcmVzdWx0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNhbmNlbFNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBhd2FpdCBjb25maWd1cmF0aW9uUmVzb2x2ZXIoKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNhbmNlbFNjaGVkdWxlZEJhY2tncm91bmRKb2JGb3JDb25maWd1cmF0aW9uKHtjb25maWd1cmF0aW9uLCBzY2hlZHVsZUtleX0pXG4gIH1cbn1cbiJdfQ==