// @ts-check
import VelociousJob from "./platform-job.js";
/** Static, bundler-safe local background-job registry. */
export default class LocalBackgroundJobRegistry {
    /**
     * Creates a registry from the configuration's statically imported job classes.
     * @param {{jobClasses: Array<typeof VelociousJob>}} args - Registry options.
     */
    constructor({ jobClasses }) {
        this.jobClasses = jobClasses;
        /** @type {Map<string, typeof VelociousJob> | undefined} */
        this.jobsByName = undefined;
    }
    /**
     * Validates and indexes the configured job classes.
     * @returns {void} - No return value.
     */
    ensureReady() {
        if (this.jobsByName)
            return;
        if (!Array.isArray(this.jobClasses))
            throw new TypeError("backgroundJobs.jobClasses must be an array");
        const jobsByName = new Map();
        for (const JobClass of this.jobClasses) {
            if (typeof JobClass !== "function" || JobClass === VelociousJob || !(JobClass.prototype instanceof VelociousJob)) {
                throw new TypeError("backgroundJobs.jobClasses must contain VelociousJob subclasses");
            }
            const jobName = JobClass.jobName();
            if (typeof jobName !== "string" || jobName.trim().length === 0) {
                throw new TypeError("backgroundJobs.jobClasses must declare non-empty job names");
            }
            if (jobsByName.has(jobName))
                throw new Error(`Duplicate local background job name: ${jobName}`);
            jobsByName.set(jobName, JobClass);
        }
        this.jobsByName = jobsByName;
    }
    /**
     * Resolves a registered class.
     * @param {string} jobName - Persisted job name.
     * @returns {typeof VelociousJob} - Registered class.
     */
    resolve(jobName) {
        this.ensureReady();
        const JobClass = this.jobsByName?.get(jobName);
        if (!JobClass)
            throw new Error(`Local background job is not registered in backgroundJobs.jobClasses: ${jobName}`);
        return JobClass;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtam9iLXJlZ2lzdHJ5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9sb2NhbC1qb2ItcmVnaXN0cnkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sWUFBWSxNQUFNLG1CQUFtQixDQUFBO0FBRTVDLDBEQUEwRDtBQUMxRCxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEwQjtJQUM3Qzs7O09BR0c7SUFDSCxZQUFZLEVBQUMsVUFBVSxFQUFDO1FBQ3RCLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLDJEQUEyRDtRQUMzRCxJQUFJLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsV0FBVztRQUNULElBQUksSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFNO1FBQzNCLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUM7WUFBRSxNQUFNLElBQUksU0FBUyxDQUFDLDRDQUE0QyxDQUFDLENBQUE7UUFFdEcsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUU1QixLQUFLLE1BQU0sUUFBUSxJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUN2QyxJQUFJLE9BQU8sUUFBUSxLQUFLLFVBQVUsSUFBSSxRQUFRLEtBQUssWUFBWSxJQUFJLENBQUMsQ0FBQyxRQUFRLENBQUMsU0FBUyxZQUFZLFlBQVksQ0FBQyxFQUFFLENBQUM7Z0JBQ2pILE1BQU0sSUFBSSxTQUFTLENBQUMsZ0VBQWdFLENBQUMsQ0FBQTtZQUN2RixDQUFDO1lBRUQsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLE9BQU8sRUFBRSxDQUFBO1lBRWxDLElBQUksT0FBTyxPQUFPLEtBQUssUUFBUSxJQUFJLE9BQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQy9ELE1BQU0sSUFBSSxTQUFTLENBQUMsNERBQTRELENBQUMsQ0FBQTtZQUNuRixDQUFDO1lBQ0QsSUFBSSxVQUFVLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQztnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdDQUF3QyxPQUFPLEVBQUUsQ0FBQyxDQUFBO1lBRS9GLFVBQVUsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQ25DLENBQUM7UUFFRCxJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQTtJQUM5QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE9BQU8sQ0FBQyxPQUFPO1FBQ2IsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBRWxCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxVQUFVLEVBQUUsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRTlDLElBQUksQ0FBQyxRQUFRO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3RUFBd0UsT0FBTyxFQUFFLENBQUMsQ0FBQTtRQUVqSCxPQUFPLFFBQVEsQ0FBQTtJQUNqQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFZlbG9jaW91c0pvYiBmcm9tIFwiLi9wbGF0Zm9ybS1qb2IuanNcIlxuXG4vKiogU3RhdGljLCBidW5kbGVyLXNhZmUgbG9jYWwgYmFja2dyb3VuZC1qb2IgcmVnaXN0cnkuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMb2NhbEJhY2tncm91bmRKb2JSZWdpc3RyeSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgcmVnaXN0cnkgZnJvbSB0aGUgY29uZmlndXJhdGlvbidzIHN0YXRpY2FsbHkgaW1wb3J0ZWQgam9iIGNsYXNzZXMuXG4gICAqIEBwYXJhbSB7e2pvYkNsYXNzZXM6IEFycmF5PHR5cGVvZiBWZWxvY2lvdXNKb2I+fX0gYXJncyAtIFJlZ2lzdHJ5IG9wdGlvbnMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7am9iQ2xhc3Nlc30pIHtcbiAgICB0aGlzLmpvYkNsYXNzZXMgPSBqb2JDbGFzc2VzXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCB0eXBlb2YgVmVsb2Npb3VzSm9iPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmpvYnNCeU5hbWUgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYW5kIGluZGV4ZXMgdGhlIGNvbmZpZ3VyZWQgam9iIGNsYXNzZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGVuc3VyZVJlYWR5KCkge1xuICAgIGlmICh0aGlzLmpvYnNCeU5hbWUpIHJldHVyblxuICAgIGlmICghQXJyYXkuaXNBcnJheSh0aGlzLmpvYkNsYXNzZXMpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiYmFja2dyb3VuZEpvYnMuam9iQ2xhc3NlcyBtdXN0IGJlIGFuIGFycmF5XCIpXG5cbiAgICBjb25zdCBqb2JzQnlOYW1lID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IEpvYkNsYXNzIG9mIHRoaXMuam9iQ2xhc3Nlcykge1xuICAgICAgaWYgKHR5cGVvZiBKb2JDbGFzcyAhPT0gXCJmdW5jdGlvblwiIHx8IEpvYkNsYXNzID09PSBWZWxvY2lvdXNKb2IgfHwgIShKb2JDbGFzcy5wcm90b3R5cGUgaW5zdGFuY2VvZiBWZWxvY2lvdXNKb2IpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJiYWNrZ3JvdW5kSm9icy5qb2JDbGFzc2VzIG11c3QgY29udGFpbiBWZWxvY2lvdXNKb2Igc3ViY2xhc3Nlc1wiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBqb2JOYW1lID0gSm9iQ2xhc3Muam9iTmFtZSgpXG5cbiAgICAgIGlmICh0eXBlb2Ygam9iTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBqb2JOYW1lLnRyaW0oKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImJhY2tncm91bmRKb2JzLmpvYkNsYXNzZXMgbXVzdCBkZWNsYXJlIG5vbi1lbXB0eSBqb2IgbmFtZXNcIilcbiAgICAgIH1cbiAgICAgIGlmIChqb2JzQnlOYW1lLmhhcyhqb2JOYW1lKSkgdGhyb3cgbmV3IEVycm9yKGBEdXBsaWNhdGUgbG9jYWwgYmFja2dyb3VuZCBqb2IgbmFtZTogJHtqb2JOYW1lfWApXG5cbiAgICAgIGpvYnNCeU5hbWUuc2V0KGpvYk5hbWUsIEpvYkNsYXNzKVxuICAgIH1cblxuICAgIHRoaXMuam9ic0J5TmFtZSA9IGpvYnNCeU5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHJlZ2lzdGVyZWQgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JOYW1lIC0gUGVyc2lzdGVkIGpvYiBuYW1lLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFZlbG9jaW91c0pvYn0gLSBSZWdpc3RlcmVkIGNsYXNzLlxuICAgKi9cbiAgcmVzb2x2ZShqb2JOYW1lKSB7XG4gICAgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBKb2JDbGFzcyA9IHRoaXMuam9ic0J5TmFtZT8uZ2V0KGpvYk5hbWUpXG5cbiAgICBpZiAoIUpvYkNsYXNzKSB0aHJvdyBuZXcgRXJyb3IoYExvY2FsIGJhY2tncm91bmQgam9iIGlzIG5vdCByZWdpc3RlcmVkIGluIGJhY2tncm91bmRKb2JzLmpvYkNsYXNzZXM6ICR7am9iTmFtZX1gKVxuXG4gICAgcmV0dXJuIEpvYkNsYXNzXG4gIH1cbn1cbiJdfQ==