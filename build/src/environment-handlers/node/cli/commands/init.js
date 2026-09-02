import BaseCommand from "../../../../cli/base-command.js";
import fileExists from "../../../../utils/file-exists.js";
import fs from "fs/promises";
/**
 * VelociousCliCommandsInit class.
 * @typedef {{source: string, target: string}} FileMappingType
 */
export default class VelociousCliCommandsInit extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void | {fileMappings: FileMappingType[]}>} - Resolves with generated file mappings, if any.
     */
    async execute() {
        const velociousPath = await this.getEnvironmentHandler().getVelociousPath();
        const projectPath = this.getConfiguration()?.getDirectory() || process.cwd();
        const projectConfigPath = `${projectPath}/src/config`;
        const fileMappings = [
            {
                source: `${velociousPath}/src/templates/configuration.js`,
                target: `${projectConfigPath}/configuration.js`
            },
            {
                source: `${velociousPath}/src/templates/routes.js`,
                target: `${projectConfigPath}/routes.js`
            }
        ];
        const paths = [
            projectConfigPath,
            `${projectPath}/src/database/migrations`,
            `${projectPath}/src/models`,
            `${projectPath}/src/routes`
        ];
        if (this.args.testing) {
            return {
                fileMappings
            };
        }
        for (const path of paths) {
            if (await fileExists(path)) {
                console.log(`Config dir already exists: ${path}`);
            }
            else {
                console.log(`Config dir doesn't exists: ${path}`);
                await fs.mkdir(path, { recursive: true });
            }
        }
        for (const fileMapping of fileMappings) {
            if (!await fileExists(fileMapping.source)) {
                throw new Error(`Template doesn't exist: ${fileMapping.source}`);
            }
            if (await fileExists(fileMapping.target)) {
                console.log(`File already exists: ${fileMapping.target}`);
            }
            else {
                console.log(`File doesnt exist: ${fileMapping.target}`);
                await fs.copyFile(fileMapping.source, fileMapping.target);
            }
        }
    }
}
const dontLoadConfiguration = true;
export { dontLoadConfiguration };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5pdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy9pbml0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sV0FBVyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3pELE9BQU8sVUFBVSxNQUFNLGtDQUFrQyxDQUFBO0FBQ3pELE9BQU8sRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUU1Qjs7O0dBR0c7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLHdCQUF5QixTQUFRLFdBQVc7SUFDL0Q7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDM0UsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLEVBQUUsWUFBWSxFQUFFLElBQUksT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBQzVFLE1BQU0saUJBQWlCLEdBQUcsR0FBRyxXQUFXLGFBQWEsQ0FBQTtRQUNyRCxNQUFNLFlBQVksR0FBRztZQUNuQjtnQkFDRSxNQUFNLEVBQUUsR0FBRyxhQUFhLGlDQUFpQztnQkFDekQsTUFBTSxFQUFFLEdBQUcsaUJBQWlCLG1CQUFtQjthQUNoRDtZQUNEO2dCQUNFLE1BQU0sRUFBRSxHQUFHLGFBQWEsMEJBQTBCO2dCQUNsRCxNQUFNLEVBQUUsR0FBRyxpQkFBaUIsWUFBWTthQUN6QztTQUNGLENBQUE7UUFDRCxNQUFNLEtBQUssR0FBRztZQUNaLGlCQUFpQjtZQUNqQixHQUFHLFdBQVcsMEJBQTBCO1lBQ3hDLEdBQUcsV0FBVyxhQUFhO1lBQzNCLEdBQUcsV0FBVyxhQUFhO1NBQzVCLENBQUE7UUFFRCxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDdEIsT0FBTztnQkFDTCxZQUFZO2FBQ2IsQ0FBQTtRQUNILENBQUM7UUFFRCxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ3pCLElBQUksTUFBTSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztnQkFDM0IsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsSUFBSSxFQUFFLENBQUMsQ0FBQTtZQUNuRCxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsSUFBSSxFQUFFLENBQUMsQ0FBQTtnQkFDakQsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxFQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBQ3pDLENBQUM7UUFDSCxDQUFDO1FBRUQsS0FBSyxNQUFNLFdBQVcsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUN2QyxJQUFJLENBQUMsTUFBTSxVQUFVLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7Z0JBQzFDLE1BQU0sSUFBSSxLQUFLLENBQUMsMkJBQTJCLFdBQVcsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFBO1lBQ2xFLENBQUM7WUFFRCxJQUFJLE1BQU0sVUFBVSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO2dCQUN6QyxPQUFPLENBQUMsR0FBRyxDQUFDLHdCQUF3QixXQUFXLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQTtZQUMzRCxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQkFBc0IsV0FBVyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUE7Z0JBQ3ZELE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUMzRCxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7Q0FDRjtBQUVELE1BQU0scUJBQXFCLEdBQUcsSUFBSSxDQUFBO0FBRWxDLE9BQU8sRUFBQyxxQkFBcUIsRUFBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEJhc2VDb21tYW5kIGZyb20gXCIuLi8uLi8uLi8uLi9jbGkvYmFzZS1jb21tYW5kLmpzXCJcbmltcG9ydCBmaWxlRXhpc3RzIGZyb20gXCIuLi8uLi8uLi8uLi91dGlscy9maWxlLWV4aXN0cy5qc1wiXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcblxuLyoqXG4gKiBWZWxvY2lvdXNDbGlDb21tYW5kc0luaXQgY2xhc3MuXG4gKiBAdHlwZWRlZiB7e3NvdXJjZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZ319IEZpbGVNYXBwaW5nVHlwZVxuICovXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0NsaUNvbW1hbmRzSW5pdCBleHRlbmRzIEJhc2VDb21tYW5kIHtcbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZCB8IHtmaWxlTWFwcGluZ3M6IEZpbGVNYXBwaW5nVHlwZVtdfT59IC0gUmVzb2x2ZXMgd2l0aCBnZW5lcmF0ZWQgZmlsZSBtYXBwaW5ncywgaWYgYW55LlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCB2ZWxvY2lvdXNQYXRoID0gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRWZWxvY2lvdXNQYXRoKClcbiAgICBjb25zdCBwcm9qZWN0UGF0aCA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpPy5nZXREaXJlY3RvcnkoKSB8fCBwcm9jZXNzLmN3ZCgpXG4gICAgY29uc3QgcHJvamVjdENvbmZpZ1BhdGggPSBgJHtwcm9qZWN0UGF0aH0vc3JjL2NvbmZpZ2BcbiAgICBjb25zdCBmaWxlTWFwcGluZ3MgPSBbXG4gICAgICB7XG4gICAgICAgIHNvdXJjZTogYCR7dmVsb2Npb3VzUGF0aH0vc3JjL3RlbXBsYXRlcy9jb25maWd1cmF0aW9uLmpzYCxcbiAgICAgICAgdGFyZ2V0OiBgJHtwcm9qZWN0Q29uZmlnUGF0aH0vY29uZmlndXJhdGlvbi5qc2BcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHNvdXJjZTogYCR7dmVsb2Npb3VzUGF0aH0vc3JjL3RlbXBsYXRlcy9yb3V0ZXMuanNgLFxuICAgICAgICB0YXJnZXQ6IGAke3Byb2plY3RDb25maWdQYXRofS9yb3V0ZXMuanNgXG4gICAgICB9XG4gICAgXVxuICAgIGNvbnN0IHBhdGhzID0gW1xuICAgICAgcHJvamVjdENvbmZpZ1BhdGgsXG4gICAgICBgJHtwcm9qZWN0UGF0aH0vc3JjL2RhdGFiYXNlL21pZ3JhdGlvbnNgLFxuICAgICAgYCR7cHJvamVjdFBhdGh9L3NyYy9tb2RlbHNgLFxuICAgICAgYCR7cHJvamVjdFBhdGh9L3NyYy9yb3V0ZXNgXG4gICAgXVxuXG4gICAgaWYgKHRoaXMuYXJncy50ZXN0aW5nKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBmaWxlTWFwcGluZ3NcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgcGF0aHMpIHtcbiAgICAgIGlmIChhd2FpdCBmaWxlRXhpc3RzKHBhdGgpKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25maWcgZGlyIGFscmVhZHkgZXhpc3RzOiAke3BhdGh9YClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25maWcgZGlyIGRvZXNuJ3QgZXhpc3RzOiAke3BhdGh9YClcbiAgICAgICAgYXdhaXQgZnMubWtkaXIocGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmaWxlTWFwcGluZyBvZiBmaWxlTWFwcGluZ3MpIHtcbiAgICAgIGlmICghYXdhaXQgZmlsZUV4aXN0cyhmaWxlTWFwcGluZy5zb3VyY2UpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVGVtcGxhdGUgZG9lc24ndCBleGlzdDogJHtmaWxlTWFwcGluZy5zb3VyY2V9YClcbiAgICAgIH1cblxuICAgICAgaWYgKGF3YWl0IGZpbGVFeGlzdHMoZmlsZU1hcHBpbmcudGFyZ2V0KSkge1xuICAgICAgICBjb25zb2xlLmxvZyhgRmlsZSBhbHJlYWR5IGV4aXN0czogJHtmaWxlTWFwcGluZy50YXJnZXR9YClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBGaWxlIGRvZXNudCBleGlzdDogJHtmaWxlTWFwcGluZy50YXJnZXR9YClcbiAgICAgICAgYXdhaXQgZnMuY29weUZpbGUoZmlsZU1hcHBpbmcuc291cmNlLCBmaWxlTWFwcGluZy50YXJnZXQpXG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmNvbnN0IGRvbnRMb2FkQ29uZmlndXJhdGlvbiA9IHRydWVcblxuZXhwb3J0IHtkb250TG9hZENvbmZpZ3VyYXRpb259XG4iXX0=