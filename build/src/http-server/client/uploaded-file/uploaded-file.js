// @ts-check
export default class UploadedFile {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.fieldName - Field name.
     * @param {string} args.filename - Filename.
     * @param {string | undefined} args.contentType - Content type.
     * @param {number} args.size - Size.
     */
    constructor({ contentType, fieldName, filename, size }) {
        if (!fieldName)
            throw new Error("fieldName is required");
        if (!filename)
            throw new Error("filename is required");
        if (typeof size !== "number")
            throw new Error("size is required");
        this.contentTypeValue = contentType;
        this.fieldNameValue = fieldName;
        this.filenameValue = filename;
        this.sizeValue = size;
    }
    contentType() { return this.contentTypeValue; }
    fieldName() { return this.fieldNameValue; }
    filename() { return this.filenameValue; }
    size() { return this.sizeValue; }
    /**
     * Runs save to.
     * @param {string} _destinationPath - Destination path.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async saveTo(_destinationPath) {
        throw new Error("Not implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXBsb2FkZWQtZmlsZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci9jbGllbnQvdXBsb2FkZWQtZmlsZS91cGxvYWRlZC1maWxlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixNQUFNLENBQUMsT0FBTyxPQUFPLFlBQVk7SUFDL0I7Ozs7Ozs7T0FPRztJQUNILFlBQVksRUFBQyxXQUFXLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUM7UUFDbEQsSUFBSSxDQUFDLFNBQVM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHVCQUF1QixDQUFDLENBQUE7UUFDeEQsSUFBSSxDQUFDLFFBQVE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixDQUFDLENBQUE7UUFDdEQsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBRWpFLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxXQUFXLENBQUE7UUFDbkMsSUFBSSxDQUFDLGNBQWMsR0FBRyxTQUFTLENBQUE7UUFDL0IsSUFBSSxDQUFDLGFBQWEsR0FBRyxRQUFRLENBQUE7UUFDN0IsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUE7SUFDdkIsQ0FBQztJQUVELFdBQVcsS0FBSyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQSxDQUFDLENBQUM7SUFDOUMsU0FBUyxLQUFLLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQSxDQUFDLENBQUM7SUFDMUMsUUFBUSxLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQSxDQUFDLENBQUM7SUFDeEMsSUFBSSxLQUFLLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQSxDQUFDLENBQUM7SUFFaEM7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxNQUFNLENBQUMsZ0JBQWdCO1FBQzNCLE1BQU0sSUFBSSxLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtJQUNwQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVXBsb2FkZWRGaWxlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZpZWxkTmFtZSAtIEZpZWxkIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZpbGVuYW1lIC0gRmlsZW5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNvbnRlbnRUeXBlIC0gQ29udGVudCB0eXBlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5zaXplIC0gU2l6ZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb250ZW50VHlwZSwgZmllbGROYW1lLCBmaWxlbmFtZSwgc2l6ZX0pIHtcbiAgICBpZiAoIWZpZWxkTmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiZmllbGROYW1lIGlzIHJlcXVpcmVkXCIpXG4gICAgaWYgKCFmaWxlbmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiZmlsZW5hbWUgaXMgcmVxdWlyZWRcIilcbiAgICBpZiAodHlwZW9mIHNpemUgIT09IFwibnVtYmVyXCIpIHRocm93IG5ldyBFcnJvcihcInNpemUgaXMgcmVxdWlyZWRcIilcblxuICAgIHRoaXMuY29udGVudFR5cGVWYWx1ZSA9IGNvbnRlbnRUeXBlXG4gICAgdGhpcy5maWVsZE5hbWVWYWx1ZSA9IGZpZWxkTmFtZVxuICAgIHRoaXMuZmlsZW5hbWVWYWx1ZSA9IGZpbGVuYW1lXG4gICAgdGhpcy5zaXplVmFsdWUgPSBzaXplXG4gIH1cblxuICBjb250ZW50VHlwZSgpIHsgcmV0dXJuIHRoaXMuY29udGVudFR5cGVWYWx1ZSB9XG4gIGZpZWxkTmFtZSgpIHsgcmV0dXJuIHRoaXMuZmllbGROYW1lVmFsdWUgfVxuICBmaWxlbmFtZSgpIHsgcmV0dXJuIHRoaXMuZmlsZW5hbWVWYWx1ZSB9XG4gIHNpemUoKSB7IHJldHVybiB0aGlzLnNpemVWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2F2ZSB0by5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9kZXN0aW5hdGlvblBhdGggLSBEZXN0aW5hdGlvbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2F2ZVRvKF9kZXN0aW5hdGlvblBhdGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWRcIilcbiAgfVxufVxuIl19