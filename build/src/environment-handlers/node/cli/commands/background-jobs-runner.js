import BaseCommand from "../../../../cli/base-command.js";
import runJobPayload from "../../../../background-jobs/job-runner.js";
export default class BackgroundJobsRunnerCommand extends BaseCommand {
    async execute() {
        const payload = process.env.VELOCIOUS_JOB_PAYLOAD;
        if (!payload)
            throw new Error("Missing VELOCIOUS_JOB_PAYLOAD");
        // A graceful worker shutdown (e.g. a deploy draining the old release)
        // SIGTERMs this spawned runner to reap it. Exit promptly so it does not
        // linger as an orphan running against deleted release code; the OS releases
        // the runner's DB/beacon sockets on exit and main's orphan sweep reclaims
        // the in-flight job.
        for (const signal of ["SIGTERM", "SIGINT"]) {
            process.once(signal, () => process.exit(0));
        }
        // Base title; runJobPayload sets the per-job title (from the job class's
        // `static processTitle`) for the duration of the job and restores this after.
        process.title = "velocious background-jobs-runner";
        const decoded = Buffer.from(payload, "base64").toString("utf8");
        const jobPayload = JSON.parse(decoded);
        await runJobPayload(jobPayload, { closeConnections: false });
        process.exit(0);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC1qb2JzLXJ1bm5lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy9iYWNrZ3JvdW5kLWpvYnMtcnVubmVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sV0FBVyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3pELE9BQU8sYUFBYSxNQUFNLDJDQUEyQyxDQUFBO0FBRXJFLE1BQU0sQ0FBQyxPQUFPLE9BQU8sMkJBQTRCLFNBQVEsV0FBVztJQUNsRSxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLENBQUE7UUFFakQsSUFBSSxDQUFDLE9BQU87WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUE7UUFFOUQsc0VBQXNFO1FBQ3RFLHdFQUF3RTtRQUN4RSw0RUFBNEU7UUFDNUUsMEVBQTBFO1FBQzFFLHFCQUFxQjtRQUNyQixLQUFLLE1BQU0sTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFDM0MsT0FBTyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQzdDLENBQUM7UUFFRCx5RUFBeUU7UUFDekUsOEVBQThFO1FBQzlFLE9BQU8sQ0FBQyxLQUFLLEdBQUcsa0NBQWtDLENBQUE7UUFFbEQsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQy9ELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFdEMsTUFBTSxhQUFhLENBQUMsVUFBVSxFQUFFLEVBQUMsZ0JBQWdCLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUMxRCxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ2pCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgcnVuSm9iUGF5bG9hZCBmcm9tIFwiLi4vLi4vLi4vLi4vYmFja2dyb3VuZC1qb2JzL2pvYi1ydW5uZXIuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic1J1bm5lckNvbW1hbmQgZXh0ZW5kcyBCYXNlQ29tbWFuZCB7XG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgY29uc3QgcGF5bG9hZCA9IHByb2Nlc3MuZW52LlZFTE9DSU9VU19KT0JfUEFZTE9BRFxuXG4gICAgaWYgKCFwYXlsb2FkKSB0aHJvdyBuZXcgRXJyb3IoXCJNaXNzaW5nIFZFTE9DSU9VU19KT0JfUEFZTE9BRFwiKVxuXG4gICAgLy8gQSBncmFjZWZ1bCB3b3JrZXIgc2h1dGRvd24gKGUuZy4gYSBkZXBsb3kgZHJhaW5pbmcgdGhlIG9sZCByZWxlYXNlKVxuICAgIC8vIFNJR1RFUk1zIHRoaXMgc3Bhd25lZCBydW5uZXIgdG8gcmVhcCBpdC4gRXhpdCBwcm9tcHRseSBzbyBpdCBkb2VzIG5vdFxuICAgIC8vIGxpbmdlciBhcyBhbiBvcnBoYW4gcnVubmluZyBhZ2FpbnN0IGRlbGV0ZWQgcmVsZWFzZSBjb2RlOyB0aGUgT1MgcmVsZWFzZXNcbiAgICAvLyB0aGUgcnVubmVyJ3MgREIvYmVhY29uIHNvY2tldHMgb24gZXhpdCBhbmQgbWFpbidzIG9ycGhhbiBzd2VlcCByZWNsYWltc1xuICAgIC8vIHRoZSBpbi1mbGlnaHQgam9iLlxuICAgIGZvciAoY29uc3Qgc2lnbmFsIG9mIFtcIlNJR1RFUk1cIiwgXCJTSUdJTlRcIl0pIHtcbiAgICAgIHByb2Nlc3Mub25jZShzaWduYWwsICgpID0+IHByb2Nlc3MuZXhpdCgwKSlcbiAgICB9XG5cbiAgICAvLyBCYXNlIHRpdGxlOyBydW5Kb2JQYXlsb2FkIHNldHMgdGhlIHBlci1qb2IgdGl0bGUgKGZyb20gdGhlIGpvYiBjbGFzcydzXG4gICAgLy8gYHN0YXRpYyBwcm9jZXNzVGl0bGVgKSBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZSBqb2IgYW5kIHJlc3RvcmVzIHRoaXMgYWZ0ZXIuXG4gICAgcHJvY2Vzcy50aXRsZSA9IFwidmVsb2Npb3VzIGJhY2tncm91bmQtam9icy1ydW5uZXJcIlxuXG4gICAgY29uc3QgZGVjb2RlZCA9IEJ1ZmZlci5mcm9tKHBheWxvYWQsIFwiYmFzZTY0XCIpLnRvU3RyaW5nKFwidXRmOFwiKVxuICAgIGNvbnN0IGpvYlBheWxvYWQgPSBKU09OLnBhcnNlKGRlY29kZWQpXG5cbiAgICBhd2FpdCBydW5Kb2JQYXlsb2FkKGpvYlBheWxvYWQsIHtjbG9zZUNvbm5lY3Rpb25zOiBmYWxzZX0pXG4gICAgcHJvY2Vzcy5leGl0KDApXG4gIH1cbn1cbiJdfQ==