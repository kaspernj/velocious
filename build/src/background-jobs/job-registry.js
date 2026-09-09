// @ts-check
import fs from "fs/promises";
import path from "path";
import toImportSpecifier from "../utils/to-import-specifier.js";
import VelociousJob from "./platform-job.js";
export default class BackgroundJobRegistry {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     */
    constructor({ configuration }) {
        this.configuration = configuration;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Map<string, typeof VelociousJob>} */
        this.jobsByName = new Map();
    }
    /**
     * Runs load.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async load() {
        const directory = this.configuration.getDirectory();
        const jobsDir = path.join(directory, "src", "jobs");
        await this._loadJobsFromDirectory(jobsDir, { skipDuplicates: false });
        const velociousPath = await this.configuration.getEnvironmentHandler().getVelociousPath();
        const velociousJobsDir = path.join(velociousPath, "src", "jobs");
        const normalizedJobsDir = path.resolve(jobsDir);
        const normalizedVelociousJobsDir = path.resolve(velociousJobsDir);
        if (normalizedJobsDir !== normalizedVelociousJobsDir) {
            await this._loadJobsFromDirectory(velociousJobsDir, { skipDuplicates: true });
        }
    }
    /**
     * Runs get job by name.
     * @param {string} jobName - Job name.
     * @returns {typeof VelociousJob} - Job class.
     */
    getJobByName(jobName) {
        const jobClass = this.jobsByName.get(jobName);
        if (!jobClass) {
            throw new Error(`Unknown job "${jobName}". Check src/jobs`);
        }
        return jobClass;
    }
    /**
     * Runs load jobs from directory.
     * @param {string} jobsDir - Directory with job files.
     * @param {object} args - Options.
     * @param {boolean} args.skipDuplicates - Whether to skip duplicate job names.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _loadJobsFromDirectory(jobsDir, { skipDuplicates }) {
        try {
            await fs.access(jobsDir);
        }
        catch {
            return;
        }
        const jobFiles = fs.glob(`${jobsDir}/**/*.js`);
        for await (const jobFile of jobFiles) {
            const jobImport = await import(toImportSpecifier(jobFile));
            const JobClass = jobImport.default;
            if (!JobClass)
                throw new Error(`Job file must export a default class: ${jobFile}`);
            if (!(JobClass.prototype instanceof VelociousJob)) {
                throw new Error(`Job class must extend VelociousJob: ${jobFile}`);
            }
            const jobName = JobClass.jobName();
            if (this.jobsByName.has(jobName)) {
                if (skipDuplicates)
                    continue;
                throw new Error(`Duplicate job name "${jobName}" from ${jobFile}`);
            }
            this.jobsByName.set(jobName, JobClass);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9iLXJlZ2lzdHJ5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9qb2ItcmVnaXN0cnkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUM1QixPQUFPLElBQUksTUFBTSxNQUFNLENBQUE7QUFDdkIsT0FBTyxpQkFBaUIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUMvRCxPQUFPLFlBQVksTUFBTSxtQkFBbUIsQ0FBQTtBQUU1QyxNQUFNLENBQUMsT0FBTyxPQUFPLHFCQUFxQjtJQUN4Qzs7OztPQUlHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBQztRQUN6QixJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtRQUNsQzs7c0RBRThDO1FBQzlDLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLElBQUk7UUFDUixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksRUFBRSxDQUFBO1FBQ25ELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUNuRCxNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLEVBQUUsRUFBQyxjQUFjLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUVuRSxNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQ3pGLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBQ2hFLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUMvQyxNQUFNLDBCQUEwQixHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUVqRSxJQUFJLGlCQUFpQixLQUFLLDBCQUEwQixFQUFFLENBQUM7WUFDckQsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsZ0JBQWdCLEVBQUUsRUFBQyxjQUFjLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUM3RSxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxZQUFZLENBQUMsT0FBTztRQUNsQixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUU3QyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDZCxNQUFNLElBQUksS0FBSyxDQUFDLGdCQUFnQixPQUFPLG1CQUFtQixDQUFDLENBQUE7UUFDN0QsQ0FBQztRQUVELE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsc0JBQXNCLENBQUMsT0FBTyxFQUFFLEVBQUMsY0FBYyxFQUFDO1FBQ3BELElBQUksQ0FBQztZQUNILE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUMxQixDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ1AsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsT0FBTyxVQUFVLENBQUMsQ0FBQTtRQUU5QyxJQUFJLEtBQUssRUFBRSxNQUFNLE9BQU8sSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUNyQyxNQUFNLFNBQVMsR0FBRyxNQUFNLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFBO1lBQzFELE1BQU0sUUFBUSxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUE7WUFFbEMsSUFBSSxDQUFDLFFBQVE7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5Q0FBeUMsT0FBTyxFQUFFLENBQUMsQ0FBQTtZQUNsRixJQUFJLENBQUMsQ0FBQyxRQUFRLENBQUMsU0FBUyxZQUFZLFlBQVksQ0FBQyxFQUFFLENBQUM7Z0JBQ2xELE1BQU0sSUFBSSxLQUFLLENBQUMsdUNBQXVDLE9BQU8sRUFBRSxDQUFDLENBQUE7WUFDbkUsQ0FBQztZQUVELE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtZQUVsQyxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7Z0JBQ2pDLElBQUksY0FBYztvQkFBRSxTQUFRO2dCQUU1QixNQUFNLElBQUksS0FBSyxDQUFDLHVCQUF1QixPQUFPLFVBQVUsT0FBTyxFQUFFLENBQUMsQ0FBQTtZQUNwRSxDQUFDO1lBRUQsSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQ3hDLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGZzIGZyb20gXCJmcy9wcm9taXNlc1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiXG5pbXBvcnQgdG9JbXBvcnRTcGVjaWZpZXIgZnJvbSBcIi4uL3V0aWxzL3RvLWltcG9ydC1zcGVjaWZpZXIuanNcIlxuaW1wb3J0IFZlbG9jaW91c0pvYiBmcm9tIFwiLi9wbGF0Zm9ybS1qb2IuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9iUmVnaXN0cnkge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9ufSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHR5cGVvZiBWZWxvY2lvdXNKb2I+fSAqL1xuICAgIHRoaXMuam9ic0J5TmFtZSA9IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGxvYWQoKSB7XG4gICAgY29uc3QgZGlyZWN0b3J5ID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpXG4gICAgY29uc3Qgam9ic0RpciA9IHBhdGguam9pbihkaXJlY3RvcnksIFwic3JjXCIsIFwiam9ic1wiKVxuICAgIGF3YWl0IHRoaXMuX2xvYWRKb2JzRnJvbURpcmVjdG9yeShqb2JzRGlyLCB7c2tpcER1cGxpY2F0ZXM6IGZhbHNlfSlcblxuICAgIGNvbnN0IHZlbG9jaW91c1BhdGggPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0VmVsb2Npb3VzUGF0aCgpXG4gICAgY29uc3QgdmVsb2Npb3VzSm9ic0RpciA9IHBhdGguam9pbih2ZWxvY2lvdXNQYXRoLCBcInNyY1wiLCBcImpvYnNcIilcbiAgICBjb25zdCBub3JtYWxpemVkSm9ic0RpciA9IHBhdGgucmVzb2x2ZShqb2JzRGlyKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRWZWxvY2lvdXNKb2JzRGlyID0gcGF0aC5yZXNvbHZlKHZlbG9jaW91c0pvYnNEaXIpXG5cbiAgICBpZiAobm9ybWFsaXplZEpvYnNEaXIgIT09IG5vcm1hbGl6ZWRWZWxvY2lvdXNKb2JzRGlyKSB7XG4gICAgICBhd2FpdCB0aGlzLl9sb2FkSm9ic0Zyb21EaXJlY3RvcnkodmVsb2Npb3VzSm9ic0Rpciwge3NraXBEdXBsaWNhdGVzOiB0cnVlfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9iIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgVmVsb2Npb3VzSm9ifSAtIEpvYiBjbGFzcy5cbiAgICovXG4gIGdldEpvYkJ5TmFtZShqb2JOYW1lKSB7XG4gICAgY29uc3Qgam9iQ2xhc3MgPSB0aGlzLmpvYnNCeU5hbWUuZ2V0KGpvYk5hbWUpXG5cbiAgICBpZiAoIWpvYkNsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gam9iIFwiJHtqb2JOYW1lfVwiLiBDaGVjayBzcmMvam9ic2ApXG4gICAgfVxuXG4gICAgcmV0dXJuIGpvYkNsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIGpvYnMgZnJvbSBkaXJlY3RvcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JzRGlyIC0gRGlyZWN0b3J5IHdpdGggam9iIGZpbGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5za2lwRHVwbGljYXRlcyAtIFdoZXRoZXIgdG8gc2tpcCBkdXBsaWNhdGUgam9iIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2xvYWRKb2JzRnJvbURpcmVjdG9yeShqb2JzRGlyLCB7c2tpcER1cGxpY2F0ZXN9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGZzLmFjY2Vzcyhqb2JzRGlyKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgam9iRmlsZXMgPSBmcy5nbG9iKGAke2pvYnNEaXJ9LyoqLyouanNgKVxuXG4gICAgZm9yIGF3YWl0IChjb25zdCBqb2JGaWxlIG9mIGpvYkZpbGVzKSB7XG4gICAgICBjb25zdCBqb2JJbXBvcnQgPSBhd2FpdCBpbXBvcnQodG9JbXBvcnRTcGVjaWZpZXIoam9iRmlsZSkpXG4gICAgICBjb25zdCBKb2JDbGFzcyA9IGpvYkltcG9ydC5kZWZhdWx0XG5cbiAgICAgIGlmICghSm9iQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgSm9iIGZpbGUgbXVzdCBleHBvcnQgYSBkZWZhdWx0IGNsYXNzOiAke2pvYkZpbGV9YClcbiAgICAgIGlmICghKEpvYkNsYXNzLnByb3RvdHlwZSBpbnN0YW5jZW9mIFZlbG9jaW91c0pvYikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBKb2IgY2xhc3MgbXVzdCBleHRlbmQgVmVsb2Npb3VzSm9iOiAke2pvYkZpbGV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3Qgam9iTmFtZSA9IEpvYkNsYXNzLmpvYk5hbWUoKVxuXG4gICAgICBpZiAodGhpcy5qb2JzQnlOYW1lLmhhcyhqb2JOYW1lKSkge1xuICAgICAgICBpZiAoc2tpcER1cGxpY2F0ZXMpIGNvbnRpbnVlXG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBEdXBsaWNhdGUgam9iIG5hbWUgXCIke2pvYk5hbWV9XCIgZnJvbSAke2pvYkZpbGV9YClcbiAgICAgIH1cblxuICAgICAgdGhpcy5qb2JzQnlOYW1lLnNldChqb2JOYW1lLCBKb2JDbGFzcylcbiAgICB9XG4gIH1cbn1cbiJdfQ==