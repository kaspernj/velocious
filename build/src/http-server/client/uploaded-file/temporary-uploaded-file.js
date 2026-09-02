// @ts-check
import fs from "fs/promises";
import UploadedFile from "./uploaded-file.js";
export default class TemporaryUploadedFile extends UploadedFile {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.path - Path.
     * @param {string} args.fieldName - Field name.
     * @param {string} args.filename - Filename.
     * @param {string | undefined} args.contentType - Content type.
     * @param {number} args.size - Size.
     */
    constructor({ contentType, fieldName, filename, path, size }) {
        super({ contentType, fieldName, filename, size });
        this.pathValue = path;
    }
    getPath() { return this.pathValue; }
    /**
     * Runs save to.
     * @param {string} destinationPath - Destination path.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async saveTo(destinationPath) {
        await fs.copyFile(this.pathValue, destinationPath);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVtcG9yYXJ5LXVwbG9hZGVkLWZpbGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3VwbG9hZGVkLWZpbGUvdGVtcG9yYXJ5LXVwbG9hZGVkLWZpbGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUM1QixPQUFPLFlBQVksTUFBTSxvQkFBb0IsQ0FBQTtBQUU3QyxNQUFNLENBQUMsT0FBTyxPQUFPLHFCQUFzQixTQUFRLFlBQVk7SUFDN0Q7Ozs7Ozs7O09BUUc7SUFDSCxZQUFZLEVBQUMsV0FBVyxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBQztRQUN4RCxLQUFLLENBQUMsRUFBQyxXQUFXLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRS9DLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFBO0lBQ3ZCLENBQUM7SUFFRCxPQUFPLEtBQUssT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFBLENBQUMsQ0FBQztJQUVuQzs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLE1BQU0sQ0FBQyxlQUFlO1FBQzFCLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFBO0lBQ3BELENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcbmltcG9ydCBVcGxvYWRlZEZpbGUgZnJvbSBcIi4vdXBsb2FkZWQtZmlsZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlbXBvcmFyeVVwbG9hZGVkRmlsZSBleHRlbmRzIFVwbG9hZGVkRmlsZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wYXRoIC0gUGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmllbGROYW1lIC0gRmllbGQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmlsZW5hbWUgLSBGaWxlbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuY29udGVudFR5cGUgLSBDb250ZW50IHR5cGUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnNpemUgLSBTaXplLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbnRlbnRUeXBlLCBmaWVsZE5hbWUsIGZpbGVuYW1lLCBwYXRoLCBzaXplfSkge1xuICAgIHN1cGVyKHtjb250ZW50VHlwZSwgZmllbGROYW1lLCBmaWxlbmFtZSwgc2l6ZX0pXG5cbiAgICB0aGlzLnBhdGhWYWx1ZSA9IHBhdGhcbiAgfVxuXG4gIGdldFBhdGgoKSB7IHJldHVybiB0aGlzLnBhdGhWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2F2ZSB0by5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRlc3RpbmF0aW9uUGF0aCAtIERlc3RpbmF0aW9uIHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzYXZlVG8oZGVzdGluYXRpb25QYXRoKSB7XG4gICAgYXdhaXQgZnMuY29weUZpbGUodGhpcy5wYXRoVmFsdWUsIGRlc3RpbmF0aW9uUGF0aClcbiAgfVxufVxuIl19