// @ts-check
import DatabaseRecord from "../database/record/index.js";
import { evaluateBackgroundJobOwnerLiveness } from "./owner-liveness.js";
export default class BackgroundJobRecord extends DatabaseRecord {
    static tableName() {
        return "background_jobs";
    }
    static primaryKey() {
        return "id";
    }
    /**
     * Evaluates whether the process that accepted this job is still alive.
     *
     * Local ownership is answered from the recorded runner hostname and OS pid.
     * Jobs accepted on another host, or jobs recorded before runner hostnames
     * existed, answer `unknown`: remote liveness needs a heartbeat or instance
     * registry, which this helper deliberately does not invent.
     * @param {object} [args] - Options.
     * @param {string} [args.hostname] - Hostname to compare against, defaults to this process's hostname.
     * @param {(pid: number) => boolean} [args.probe] - Process probe, injectable for tests.
     * @returns {import("./owner-liveness.js").BackgroundJobOwnerLivenessResult} - Liveness verdict.
     */
    ownerIsAlive({ hostname, probe } = {}) {
        return evaluateBackgroundJobOwnerLiveness({
            childInstanceId: /** @type {string | null} */ (this.readAttribute("childInstanceId")),
            childPid: /** @type {number | null} */ (this.readAttribute("childPid")),
            currentHostname: hostname,
            probe,
            runnerHostname: /** @type {string | null} */ (this.readAttribute("runnerHostname"))
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9iLXJlY29yZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvam9iLXJlY29yZC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxjQUFjLE1BQU0sNkJBQTZCLENBQUE7QUFDeEQsT0FBTyxFQUFFLGtDQUFrQyxFQUFFLE1BQU0scUJBQXFCLENBQUE7QUFFeEUsTUFBTSxDQUFDLE9BQU8sT0FBTyxtQkFBb0IsU0FBUSxjQUFjO0lBQzdELE1BQU0sQ0FBQyxTQUFTO1FBQ2QsT0FBTyxpQkFBaUIsQ0FBQTtJQUMxQixDQUFDO0lBRUQsTUFBTSxDQUFDLFVBQVU7UUFDZixPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7T0FXRztJQUNILFlBQVksQ0FBQyxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUMsR0FBRyxFQUFFO1FBQ2pDLE9BQU8sa0NBQWtDLENBQUM7WUFDeEMsZUFBZSxFQUFFLDRCQUE0QixDQUFDLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1lBQ3JGLFFBQVEsRUFBRSw0QkFBNEIsQ0FBQyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDdkUsZUFBZSxFQUFFLFFBQVE7WUFDekIsS0FBSztZQUNMLGNBQWMsRUFBRSw0QkFBNEIsQ0FBQyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztTQUNwRixDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IERhdGFiYXNlUmVjb3JkIGZyb20gXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIlxuaW1wb3J0IHsgZXZhbHVhdGVCYWNrZ3JvdW5kSm9iT3duZXJMaXZlbmVzcyB9IGZyb20gXCIuL293bmVyLWxpdmVuZXNzLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYlJlY29yZCBleHRlbmRzIERhdGFiYXNlUmVjb3JkIHtcbiAgc3RhdGljIHRhYmxlTmFtZSgpIHtcbiAgICByZXR1cm4gXCJiYWNrZ3JvdW5kX2pvYnNcIlxuICB9XG5cbiAgc3RhdGljIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIFwiaWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIEV2YWx1YXRlcyB3aGV0aGVyIHRoZSBwcm9jZXNzIHRoYXQgYWNjZXB0ZWQgdGhpcyBqb2IgaXMgc3RpbGwgYWxpdmUuXG4gICAqXG4gICAqIExvY2FsIG93bmVyc2hpcCBpcyBhbnN3ZXJlZCBmcm9tIHRoZSByZWNvcmRlZCBydW5uZXIgaG9zdG5hbWUgYW5kIE9TIHBpZC5cbiAgICogSm9icyBhY2NlcHRlZCBvbiBhbm90aGVyIGhvc3QsIG9yIGpvYnMgcmVjb3JkZWQgYmVmb3JlIHJ1bm5lciBob3N0bmFtZXNcbiAgICogZXhpc3RlZCwgYW5zd2VyIGB1bmtub3duYDogcmVtb3RlIGxpdmVuZXNzIG5lZWRzIGEgaGVhcnRiZWF0IG9yIGluc3RhbmNlXG4gICAqIHJlZ2lzdHJ5LCB3aGljaCB0aGlzIGhlbHBlciBkZWxpYmVyYXRlbHkgZG9lcyBub3QgaW52ZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RuYW1lXSAtIEhvc3RuYW1lIHRvIGNvbXBhcmUgYWdhaW5zdCwgZGVmYXVsdHMgdG8gdGhpcyBwcm9jZXNzJ3MgaG9zdG5hbWUuXG4gICAqIEBwYXJhbSB7KHBpZDogbnVtYmVyKSA9PiBib29sZWFufSBbYXJncy5wcm9iZV0gLSBQcm9jZXNzIHByb2JlLCBpbmplY3RhYmxlIGZvciB0ZXN0cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vb3duZXItbGl2ZW5lc3MuanNcIikuQmFja2dyb3VuZEpvYk93bmVyTGl2ZW5lc3NSZXN1bHR9IC0gTGl2ZW5lc3MgdmVyZGljdC5cbiAgICovXG4gIG93bmVySXNBbGl2ZSh7aG9zdG5hbWUsIHByb2JlfSA9IHt9KSB7XG4gICAgcmV0dXJuIGV2YWx1YXRlQmFja2dyb3VuZEpvYk93bmVyTGl2ZW5lc3Moe1xuICAgICAgY2hpbGRJbnN0YW5jZUlkOiAvKiogQHR5cGUge3N0cmluZyB8IG51bGx9ICovICh0aGlzLnJlYWRBdHRyaWJ1dGUoXCJjaGlsZEluc3RhbmNlSWRcIikpLFxuICAgICAgY2hpbGRQaWQ6IC8qKiBAdHlwZSB7bnVtYmVyIHwgbnVsbH0gKi8gKHRoaXMucmVhZEF0dHJpYnV0ZShcImNoaWxkUGlkXCIpKSxcbiAgICAgIGN1cnJlbnRIb3N0bmFtZTogaG9zdG5hbWUsXG4gICAgICBwcm9iZSxcbiAgICAgIHJ1bm5lckhvc3RuYW1lOiAvKiogQHR5cGUge3N0cmluZyB8IG51bGx9ICovICh0aGlzLnJlYWRBdHRyaWJ1dGUoXCJydW5uZXJIb3N0bmFtZVwiKSlcbiAgICB9KVxuICB9XG59XG4iXX0=