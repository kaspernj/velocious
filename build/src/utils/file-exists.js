// @ts-check
import fs from "fs/promises";
/**
 * Runs file exists.
 * @param {string} path - Path.
 * @returns {Promise<boolean>} - Resolves with Whether the operation succeeded.
 */
export default async function fileExists(path) {
    try {
        await fs.access(path);
        return true;
    }
    catch (error) { // eslint-disable-line no-unused-vars
        return false;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmlsZS1leGlzdHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvZmlsZS1leGlzdHMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUU1Qjs7OztHQUlHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLFVBQVUsVUFBVSxDQUFDLElBQUk7SUFDM0MsSUFBSSxDQUFDO1FBQ0gsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRXJCLE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUMsQ0FBQyxxQ0FBcUM7UUFDckQsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcblxuLyoqXG4gKiBSdW5zIGZpbGUgZXhpc3RzLlxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBQYXRoLlxuICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgd2l0aCBXaGV0aGVyIHRoZSBvcGVyYXRpb24gc3VjY2VlZGVkLlxuICovXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBmaWxlRXhpc3RzKHBhdGgpIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmcy5hY2Nlc3MocGF0aClcblxuICAgIHJldHVybiB0cnVlXG4gIH0gY2F0Y2ggKGVycm9yKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuIl19