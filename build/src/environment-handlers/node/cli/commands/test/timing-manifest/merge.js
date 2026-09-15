// @ts-check
import BaseCommand from "../../../../../../cli/base-command.js";
import { parseTimingManifestMergeArguments as parsePackageTimingManifestMergeArguments } from "@velocious/testing/node";
import fs from "node:fs/promises";
import { writeTimingManifest } from "../../../../../../testing/test-profile-output.js";
import { mergeTestProfileTimingManifests } from "../../../../../../testing/timing-manifest.js";
/**
 * @typedef {object} TimingManifestMergeArguments
 * @property {string[]} inputPaths - Rich profile input paths.
 * @property {string} outputPath - Plain timing manifest output path.
 */
/** Node implementation for timing-manifest aggregation. */
export default class TestTimingManifestMerge extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<Record<string, number>>} - Complete merged timing manifest.
     */
    async execute() {
        const { inputPaths, outputPath } = parseTimingManifestMergeArguments(this.processArgs || [], process.cwd());
        const inputs = [];
        for (const inputPath of inputPaths) {
            let content;
            try {
                content = await fs.readFile(inputPath, "utf8");
            }
            catch (error) {
                throw new Error(`Failed to read test profile: ${inputPath}`, { cause: error });
            }
            let profile;
            try {
                profile = JSON.parse(content);
            }
            catch (error) {
                throw new Error(`Failed to parse test profile: ${inputPath}`, { cause: error });
            }
            inputs.push({ profile, source: inputPath });
        }
        const timingManifest = mergeTestProfileTimingManifests(inputs);
        await writeTimingManifest({ outputPath, timingManifest });
        console.log(`Merged ${inputPaths.length} test profile shards into ${outputPath} (${Object.keys(timingManifest).length} files)`);
        return timingManifest;
    }
}
/**
 * Parses strict merge arguments and resolves their paths.
 * @param {string[]} processArgs - Raw CLI arguments, including command name.
 * @param {string} cwd - Command working directory.
 * @returns {TimingManifestMergeArguments} - Validated resolved paths.
 */
export function parseTimingManifestMergeArguments(processArgs, cwd) {
    return parsePackageTimingManifestMergeArguments(processArgs.slice(1), { cwd });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVyZ2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9zcmMvZW52aXJvbm1lbnQtaGFuZGxlcnMvbm9kZS9jbGkvY29tbWFuZHMvdGVzdC90aW1pbmctbWFuaWZlc3QvbWVyZ2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sV0FBVyxNQUFNLHVDQUF1QyxDQUFBO0FBQy9ELE9BQU8sRUFBRSxpQ0FBaUMsSUFBSSx3Q0FBd0MsRUFBRSxNQUFNLHlCQUF5QixDQUFBO0FBQ3ZILE9BQU8sRUFBRSxNQUFNLGtCQUFrQixDQUFBO0FBQ2pDLE9BQU8sRUFBRSxtQkFBbUIsRUFBRSxNQUFNLGtEQUFrRCxDQUFBO0FBQ3RGLE9BQU8sRUFBRSwrQkFBK0IsRUFBRSxNQUFNLDhDQUE4QyxDQUFBO0FBRTlGOzs7O0dBSUc7QUFFSCwyREFBMkQ7QUFDM0QsTUFBTSxDQUFDLE9BQU8sT0FBTyx1QkFBd0IsU0FBUSxXQUFXO0lBQzlEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxFQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUMsR0FBRyxpQ0FBaUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQTtRQUN6RyxNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUE7UUFFakIsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUNuQyxJQUFJLE9BQU8sQ0FBQTtZQUVYLElBQUksQ0FBQztnQkFDSCxPQUFPLEdBQUcsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLFNBQVMsRUFBRSxNQUFNLENBQUMsQ0FBQTtZQUNoRCxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixNQUFNLElBQUksS0FBSyxDQUFDLGdDQUFnQyxTQUFTLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQzlFLENBQUM7WUFFRCxJQUFJLE9BQU8sQ0FBQTtZQUVYLElBQUksQ0FBQztnQkFDSCxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUMvQixDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixNQUFNLElBQUksS0FBSyxDQUFDLGlDQUFpQyxTQUFTLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQy9FLENBQUM7WUFFRCxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBQzNDLENBQUM7UUFFRCxNQUFNLGNBQWMsR0FBRywrQkFBK0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUU5RCxNQUFNLG1CQUFtQixDQUFDLEVBQUMsVUFBVSxFQUFFLGNBQWMsRUFBQyxDQUFDLENBQUE7UUFDdkQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLFVBQVUsQ0FBQyxNQUFNLDZCQUE2QixVQUFVLEtBQUssTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQyxNQUFNLFNBQVMsQ0FBQyxDQUFBO1FBRS9ILE9BQU8sY0FBYyxDQUFBO0lBQ3ZCLENBQUM7Q0FDRjtBQUVEOzs7OztHQUtHO0FBQ0gsTUFBTSxVQUFVLGlDQUFpQyxDQUFDLFdBQVcsRUFBRSxHQUFHO0lBQ2hFLE9BQU8sd0NBQXdDLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFDLEdBQUcsRUFBQyxDQUFDLENBQUE7QUFDOUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uLy4uLy4uLy4uLy4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IHsgcGFyc2VUaW1pbmdNYW5pZmVzdE1lcmdlQXJndW1lbnRzIGFzIHBhcnNlUGFja2FnZVRpbWluZ01hbmlmZXN0TWVyZ2VBcmd1bWVudHMgfSBmcm9tIFwiQHZlbG9jaW91cy90ZXN0aW5nL25vZGVcIlxuaW1wb3J0IGZzIGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCJcbmltcG9ydCB7IHdyaXRlVGltaW5nTWFuaWZlc3QgfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vLi4vdGVzdGluZy90ZXN0LXByb2ZpbGUtb3V0cHV0LmpzXCJcbmltcG9ydCB7IG1lcmdlVGVzdFByb2ZpbGVUaW1pbmdNYW5pZmVzdHMgfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vLi4vdGVzdGluZy90aW1pbmctbWFuaWZlc3QuanNcIlxuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRpbWluZ01hbmlmZXN0TWVyZ2VBcmd1bWVudHNcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGlucHV0UGF0aHMgLSBSaWNoIHByb2ZpbGUgaW5wdXQgcGF0aHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gb3V0cHV0UGF0aCAtIFBsYWluIHRpbWluZyBtYW5pZmVzdCBvdXRwdXQgcGF0aC5cbiAqL1xuXG4vKiogTm9kZSBpbXBsZW1lbnRhdGlvbiBmb3IgdGltaW5nLW1hbmlmZXN0IGFnZ3JlZ2F0aW9uLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGVzdFRpbWluZ01hbmlmZXN0TWVyZ2UgZXh0ZW5kcyBCYXNlQ29tbWFuZCB7XG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAtIENvbXBsZXRlIG1lcmdlZCB0aW1pbmcgbWFuaWZlc3QuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGNvbnN0IHtpbnB1dFBhdGhzLCBvdXRwdXRQYXRofSA9IHBhcnNlVGltaW5nTWFuaWZlc3RNZXJnZUFyZ3VtZW50cyh0aGlzLnByb2Nlc3NBcmdzIHx8IFtdLCBwcm9jZXNzLmN3ZCgpKVxuICAgIGNvbnN0IGlucHV0cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGlucHV0UGF0aCBvZiBpbnB1dFBhdGhzKSB7XG4gICAgICBsZXQgY29udGVudFxuXG4gICAgICB0cnkge1xuICAgICAgICBjb250ZW50ID0gYXdhaXQgZnMucmVhZEZpbGUoaW5wdXRQYXRoLCBcInV0ZjhcIilcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHJlYWQgdGVzdCBwcm9maWxlOiAke2lucHV0UGF0aH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH1cblxuICAgICAgbGV0IHByb2ZpbGVcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcHJvZmlsZSA9IEpTT04ucGFyc2UoY29udGVudClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHBhcnNlIHRlc3QgcHJvZmlsZTogJHtpbnB1dFBhdGh9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9XG5cbiAgICAgIGlucHV0cy5wdXNoKHtwcm9maWxlLCBzb3VyY2U6IGlucHV0UGF0aH0pXG4gICAgfVxuXG4gICAgY29uc3QgdGltaW5nTWFuaWZlc3QgPSBtZXJnZVRlc3RQcm9maWxlVGltaW5nTWFuaWZlc3RzKGlucHV0cylcblxuICAgIGF3YWl0IHdyaXRlVGltaW5nTWFuaWZlc3Qoe291dHB1dFBhdGgsIHRpbWluZ01hbmlmZXN0fSlcbiAgICBjb25zb2xlLmxvZyhgTWVyZ2VkICR7aW5wdXRQYXRocy5sZW5ndGh9IHRlc3QgcHJvZmlsZSBzaGFyZHMgaW50byAke291dHB1dFBhdGh9ICgke09iamVjdC5rZXlzKHRpbWluZ01hbmlmZXN0KS5sZW5ndGh9IGZpbGVzKWApXG5cbiAgICByZXR1cm4gdGltaW5nTWFuaWZlc3RcbiAgfVxufVxuXG4vKipcbiAqIFBhcnNlcyBzdHJpY3QgbWVyZ2UgYXJndW1lbnRzIGFuZCByZXNvbHZlcyB0aGVpciBwYXRocy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IHByb2Nlc3NBcmdzIC0gUmF3IENMSSBhcmd1bWVudHMsIGluY2x1ZGluZyBjb21tYW5kIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gY3dkIC0gQ29tbWFuZCB3b3JraW5nIGRpcmVjdG9yeS5cbiAqIEByZXR1cm5zIHtUaW1pbmdNYW5pZmVzdE1lcmdlQXJndW1lbnRzfSAtIFZhbGlkYXRlZCByZXNvbHZlZCBwYXRocy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlVGltaW5nTWFuaWZlc3RNZXJnZUFyZ3VtZW50cyhwcm9jZXNzQXJncywgY3dkKSB7XG4gIHJldHVybiBwYXJzZVBhY2thZ2VUaW1pbmdNYW5pZmVzdE1lcmdlQXJndW1lbnRzKHByb2Nlc3NBcmdzLnNsaWNlKDEpLCB7Y3dkfSlcbn1cbiJdfQ==