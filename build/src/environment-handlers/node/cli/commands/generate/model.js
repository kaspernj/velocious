import BaseCommand from "../../../../../cli/base-command.js";
import fileExists from "../../../../../utils/file-exists.js";
import fs from "fs/promises";
import * as inflection from "inflection";
/**
 * DbGenerateModel class.
 * @typedef {{date: Date, modelContent: string, modelName: string, modelNameCamelized: string, modelPath: string}} DbGenerateModelResult
 */
export default class DbGenerateModel extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void | DbGenerateModelResult>} - Resolves with the execute.
     */
    async execute() {
        const modelName = this.processArgs?.[1];
        if (!modelName)
            throw new Error("Expected model name");
        const modelNameCamelized = inflection.camelize(modelName.replaceAll("-", "_"));
        const date = new Date();
        const modelFileName = `${inflection.dasherize(inflection.underscore(modelName))}.js`;
        const velociousPath = await this.getEnvironmentHandler().getVelociousPath();
        const templateFilePath = `${velociousPath}/src/templates/generate-model.js`;
        const modelContentBuffer = await fs.readFile(templateFilePath);
        const modelContent = modelContentBuffer.toString().replaceAll("__MODEL_NAME__", modelNameCamelized);
        const modelsDir = `${process.cwd()}/src/models`;
        const modelPath = `${modelsDir}/${modelFileName}`;
        if (await fileExists(modelPath))
            throw new Error(`Model file already exists: ${modelPath}`);
        if (this.args.testing) {
            return { date, modelContent, modelName, modelNameCamelized, modelPath };
        }
        else {
            if (!await fileExists(modelsDir)) {
                await fs.mkdir(modelsDir, { recursive: true });
            }
            await fs.writeFile(modelPath, modelContent);
            console.log(`create src/models/${modelFileName}`);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9zcmMvZW52aXJvbm1lbnQtaGFuZGxlcnMvbm9kZS9jbGkvY29tbWFuZHMvZ2VuZXJhdGUvbW9kZWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxXQUFXLE1BQU0sb0NBQW9DLENBQUE7QUFDNUQsT0FBTyxVQUFVLE1BQU0scUNBQXFDLENBQUE7QUFDNUQsT0FBTyxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQzVCLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBRXhDOzs7R0FHRztBQUVILE1BQU0sQ0FBQyxPQUFPLE9BQU8sZUFBZ0IsU0FBUSxXQUFXO0lBQ3REOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRXZDLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO1FBRXRELE1BQU0sa0JBQWtCLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFBO1FBQzlFLE1BQU0sSUFBSSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUE7UUFDdkIsTUFBTSxhQUFhLEdBQUcsR0FBRyxVQUFVLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLENBQUMsS0FBSyxDQUFBO1FBQ3BGLE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUMzRSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsYUFBYSxrQ0FBa0MsQ0FBQTtRQUMzRSxNQUFNLGtCQUFrQixHQUFHLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBQzlELE1BQU0sWUFBWSxHQUFHLGtCQUFrQixDQUFDLFFBQVEsRUFBRSxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxrQkFBa0IsQ0FBQyxDQUFBO1FBQ25HLE1BQU0sU0FBUyxHQUFHLEdBQUcsT0FBTyxDQUFDLEdBQUcsRUFBRSxhQUFhLENBQUE7UUFDL0MsTUFBTSxTQUFTLEdBQUcsR0FBRyxTQUFTLElBQUksYUFBYSxFQUFFLENBQUE7UUFFakQsSUFBSSxNQUFNLFVBQVUsQ0FBQyxTQUFTLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDhCQUE4QixTQUFTLEVBQUUsQ0FBQyxDQUFBO1FBRTNGLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0QixPQUFPLEVBQUMsSUFBSSxFQUFFLFlBQVksRUFBRSxTQUFTLEVBQUUsa0JBQWtCLEVBQUUsU0FBUyxFQUFDLENBQUE7UUFDdkUsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsTUFBTSxVQUFVLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztnQkFDakMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRSxFQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBQzlDLENBQUM7WUFFRCxNQUFNLEVBQUUsQ0FBQyxTQUFTLENBQUMsU0FBUyxFQUFFLFlBQVksQ0FBQyxDQUFBO1lBRTNDLE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLGFBQWEsRUFBRSxDQUFDLENBQUE7UUFDbkQsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgZmlsZUV4aXN0cyBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vdXRpbHMvZmlsZS1leGlzdHMuanNcIlxuaW1wb3J0IGZzIGZyb20gXCJmcy9wcm9taXNlc1wiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcblxuLyoqXG4gKiBEYkdlbmVyYXRlTW9kZWwgY2xhc3MuXG4gKiBAdHlwZWRlZiB7e2RhdGU6IERhdGUsIG1vZGVsQ29udGVudDogc3RyaW5nLCBtb2RlbE5hbWU6IHN0cmluZywgbW9kZWxOYW1lQ2FtZWxpemVkOiBzdHJpbmcsIG1vZGVsUGF0aDogc3RyaW5nfX0gRGJHZW5lcmF0ZU1vZGVsUmVzdWx0XG4gKi9cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRGJHZW5lcmF0ZU1vZGVsIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICAvKipcbiAgICogUnVucyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkIHwgRGJHZW5lcmF0ZU1vZGVsUmVzdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBleGVjdXRlLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCBtb2RlbE5hbWUgPSB0aGlzLnByb2Nlc3NBcmdzPy5bMV1cblxuICAgIGlmICghbW9kZWxOYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBtb2RlbCBuYW1lXCIpXG5cbiAgICBjb25zdCBtb2RlbE5hbWVDYW1lbGl6ZWQgPSBpbmZsZWN0aW9uLmNhbWVsaXplKG1vZGVsTmFtZS5yZXBsYWNlQWxsKFwiLVwiLCBcIl9cIikpXG4gICAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKClcbiAgICBjb25zdCBtb2RlbEZpbGVOYW1lID0gYCR7aW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKG1vZGVsTmFtZSkpfS5qc2BcbiAgICBjb25zdCB2ZWxvY2lvdXNQYXRoID0gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRWZWxvY2lvdXNQYXRoKClcbiAgICBjb25zdCB0ZW1wbGF0ZUZpbGVQYXRoID0gYCR7dmVsb2Npb3VzUGF0aH0vc3JjL3RlbXBsYXRlcy9nZW5lcmF0ZS1tb2RlbC5qc2BcbiAgICBjb25zdCBtb2RlbENvbnRlbnRCdWZmZXIgPSBhd2FpdCBmcy5yZWFkRmlsZSh0ZW1wbGF0ZUZpbGVQYXRoKVxuICAgIGNvbnN0IG1vZGVsQ29udGVudCA9IG1vZGVsQ29udGVudEJ1ZmZlci50b1N0cmluZygpLnJlcGxhY2VBbGwoXCJfX01PREVMX05BTUVfX1wiLCBtb2RlbE5hbWVDYW1lbGl6ZWQpXG4gICAgY29uc3QgbW9kZWxzRGlyID0gYCR7cHJvY2Vzcy5jd2QoKX0vc3JjL21vZGVsc2BcbiAgICBjb25zdCBtb2RlbFBhdGggPSBgJHttb2RlbHNEaXJ9LyR7bW9kZWxGaWxlTmFtZX1gXG5cbiAgICBpZiAoYXdhaXQgZmlsZUV4aXN0cyhtb2RlbFBhdGgpKSB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsIGZpbGUgYWxyZWFkeSBleGlzdHM6ICR7bW9kZWxQYXRofWApXG5cbiAgICBpZiAodGhpcy5hcmdzLnRlc3RpbmcpIHtcbiAgICAgIHJldHVybiB7ZGF0ZSwgbW9kZWxDb250ZW50LCBtb2RlbE5hbWUsIG1vZGVsTmFtZUNhbWVsaXplZCwgbW9kZWxQYXRofVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIWF3YWl0IGZpbGVFeGlzdHMobW9kZWxzRGlyKSkge1xuICAgICAgICBhd2FpdCBmcy5ta2Rpcihtb2RlbHNEaXIsIHtyZWN1cnNpdmU6IHRydWV9KVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBmcy53cml0ZUZpbGUobW9kZWxQYXRoLCBtb2RlbENvbnRlbnQpXG5cbiAgICAgIGNvbnNvbGUubG9nKGBjcmVhdGUgc3JjL21vZGVscy8ke21vZGVsRmlsZU5hbWV9YClcbiAgICB9XG4gIH1cbn1cbiJdfQ==