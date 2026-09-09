// @ts-check
import fs from "fs/promises";
import UploadedFile from "./uploaded-file.js";
export default class MemoryUploadedFile extends UploadedFile {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Buffer} args.buffer - Buffer.
     * @param {string} args.fieldName - Field name.
     * @param {string} args.filename - Filename.
     * @param {string | undefined} args.contentType - Content type.
     * @param {number} args.size - Size.
     */
    constructor({ buffer, contentType, fieldName, filename, size }) {
        super({ contentType, fieldName, filename, size });
        this.buffer = buffer;
    }
    getBuffer() { return this.buffer; }
    /**
     * Runs save to.
     * @param {string} destinationPath - Destination path.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async saveTo(destinationPath) {
        await fs.writeFile(destinationPath, this.buffer);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVtb3J5LXVwbG9hZGVkLWZpbGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3VwbG9hZGVkLWZpbGUvbWVtb3J5LXVwbG9hZGVkLWZpbGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUM1QixPQUFPLFlBQVksTUFBTSxvQkFBb0IsQ0FBQTtBQUU3QyxNQUFNLENBQUMsT0FBTyxPQUFPLGtCQUFtQixTQUFRLFlBQVk7SUFDMUQ7Ozs7Ozs7O09BUUc7SUFDSCxZQUFZLEVBQUMsTUFBTSxFQUFFLFdBQVcsRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBQztRQUMxRCxLQUFLLENBQUMsRUFBQyxXQUFXLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRS9DLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFBO0lBQ3RCLENBQUM7SUFFRCxTQUFTLEtBQUssT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFBLENBQUMsQ0FBQztJQUVsQzs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLE1BQU0sQ0FBQyxlQUFlO1FBQzFCLE1BQU0sRUFBRSxDQUFDLFNBQVMsQ0FBQyxlQUFlLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ2xELENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcbmltcG9ydCBVcGxvYWRlZEZpbGUgZnJvbSBcIi4vdXBsb2FkZWQtZmlsZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE1lbW9yeVVwbG9hZGVkRmlsZSBleHRlbmRzIFVwbG9hZGVkRmlsZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gYXJncy5idWZmZXIgLSBCdWZmZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZpZWxkTmFtZSAtIEZpZWxkIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZpbGVuYW1lIC0gRmlsZW5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNvbnRlbnRUeXBlIC0gQ29udGVudCB0eXBlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5zaXplIC0gU2l6ZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtidWZmZXIsIGNvbnRlbnRUeXBlLCBmaWVsZE5hbWUsIGZpbGVuYW1lLCBzaXplfSkge1xuICAgIHN1cGVyKHtjb250ZW50VHlwZSwgZmllbGROYW1lLCBmaWxlbmFtZSwgc2l6ZX0pXG5cbiAgICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlclxuICB9XG5cbiAgZ2V0QnVmZmVyKCkgeyByZXR1cm4gdGhpcy5idWZmZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNhdmUgdG8uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkZXN0aW5hdGlvblBhdGggLSBEZXN0aW5hdGlvbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2F2ZVRvKGRlc3RpbmF0aW9uUGF0aCkge1xuICAgIGF3YWl0IGZzLndyaXRlRmlsZShkZXN0aW5hdGlvblBhdGgsIHRoaXMuYnVmZmVyKVxuICB9XG59XG4iXX0=