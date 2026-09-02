import BaseCommand from "../../../../../cli/base-command.js";
import fs from "fs/promises";
/**
 * DbDestroyMigration class.
 * @typedef {{destroyed: string[]}} DestroyMigrationResult
 */
export default class DbDestroyMigration extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void | DestroyMigrationResult>} - Resolves with the execute.
     */
    async execute() {
        const migrationName = this.processArgs?.[1];
        if (!migrationName)
            throw new Error("Expected migration name");
        const migrationDir = `${this.getConfiguration().getDirectory()}/src/database/migrations`;
        const migrationFiles = await fs.readdir(migrationDir);
        const destroyed = [];
        for (const migrationFile of migrationFiles) {
            const match = migrationFile.match(/^(\d{14})-(.+)\.js$/);
            if (!match) {
                continue;
            }
            const fileName = match[2];
            if (fileName != migrationName)
                continue;
            const fullFilePath = `${migrationDir}/${migrationFile}`;
            destroyed.push(fileName);
            if (!this.args.testing) {
                console.log(`Destroy src/database/migrations/${migrationFile}`);
                await fs.unlink(fullFilePath);
            }
        }
        if (this.args.testing) {
            return { destroyed };
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2Vudmlyb25tZW50LWhhbmRsZXJzL25vZGUvY2xpL2NvbW1hbmRzL2Rlc3Ryb3kvbWlncmF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sV0FBVyxNQUFNLG9DQUFvQyxDQUFBO0FBQzVELE9BQU8sRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUU1Qjs7O0dBR0c7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLGtCQUFtQixTQUFRLFdBQVc7SUFDekQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFM0MsSUFBSSxDQUFDLGFBQWE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUE7UUFFOUQsTUFBTSxZQUFZLEdBQUcsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxZQUFZLEVBQUUsMEJBQTBCLENBQUE7UUFDeEYsTUFBTSxjQUFjLEdBQUcsTUFBTSxFQUFFLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFBO1FBQ3JELE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUVwQixLQUFLLE1BQU0sYUFBYSxJQUFJLGNBQWMsRUFBRSxDQUFDO1lBQzNDLE1BQU0sS0FBSyxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMscUJBQXFCLENBQUMsQ0FBQTtZQUV4RCxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7Z0JBQ1gsU0FBUTtZQUNWLENBQUM7WUFFRCxNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFFekIsSUFBSSxRQUFRLElBQUksYUFBYTtnQkFBRSxTQUFRO1lBRXZDLE1BQU0sWUFBWSxHQUFHLEdBQUcsWUFBWSxJQUFJLGFBQWEsRUFBRSxDQUFBO1lBQ3ZELFNBQVMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7WUFFeEIsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ3ZCLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUNBQW1DLGFBQWEsRUFBRSxDQUFDLENBQUE7Z0JBQy9ELE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQTtZQUMvQixDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0QixPQUFPLEVBQUMsU0FBUyxFQUFDLENBQUE7UUFDcEIsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcblxuLyoqXG4gKiBEYkRlc3Ryb3lNaWdyYXRpb24gY2xhc3MuXG4gKiBAdHlwZWRlZiB7e2Rlc3Ryb3llZDogc3RyaW5nW119fSBEZXN0cm95TWlncmF0aW9uUmVzdWx0XG4gKi9cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRGJEZXN0cm95TWlncmF0aW9uIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICAvKipcbiAgICogUnVucyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkIHwgRGVzdHJveU1pZ3JhdGlvblJlc3VsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZXhlY3V0ZS5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgY29uc3QgbWlncmF0aW9uTmFtZSA9IHRoaXMucHJvY2Vzc0FyZ3M/LlsxXVxuXG4gICAgaWYgKCFtaWdyYXRpb25OYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBtaWdyYXRpb24gbmFtZVwiKVxuXG4gICAgY29uc3QgbWlncmF0aW9uRGlyID0gYCR7dGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGlyZWN0b3J5KCl9L3NyYy9kYXRhYmFzZS9taWdyYXRpb25zYFxuICAgIGNvbnN0IG1pZ3JhdGlvbkZpbGVzID0gYXdhaXQgZnMucmVhZGRpcihtaWdyYXRpb25EaXIpXG4gICAgY29uc3QgZGVzdHJveWVkID0gW11cblxuICAgIGZvciAoY29uc3QgbWlncmF0aW9uRmlsZSBvZiBtaWdyYXRpb25GaWxlcykge1xuICAgICAgY29uc3QgbWF0Y2ggPSBtaWdyYXRpb25GaWxlLm1hdGNoKC9eKFxcZHsxNH0pLSguKylcXC5qcyQvKVxuXG4gICAgICBpZiAoIW1hdGNoKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGZpbGVOYW1lID0gbWF0Y2hbMl1cblxuICAgICAgaWYgKGZpbGVOYW1lICE9IG1pZ3JhdGlvbk5hbWUpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGZ1bGxGaWxlUGF0aCA9IGAke21pZ3JhdGlvbkRpcn0vJHttaWdyYXRpb25GaWxlfWBcbiAgICAgIGRlc3Ryb3llZC5wdXNoKGZpbGVOYW1lKVxuXG4gICAgICBpZiAoIXRoaXMuYXJncy50ZXN0aW5nKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBEZXN0cm95IHNyYy9kYXRhYmFzZS9taWdyYXRpb25zLyR7bWlncmF0aW9uRmlsZX1gKVxuICAgICAgICBhd2FpdCBmcy51bmxpbmsoZnVsbEZpbGVQYXRoKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLmFyZ3MudGVzdGluZykge1xuICAgICAgcmV0dXJuIHtkZXN0cm95ZWR9XG4gICAgfVxuICB9XG59XG4iXX0=