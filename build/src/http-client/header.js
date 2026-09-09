// @ts-check
export default class Header {
    /**
     * Runs constructor.
     * @param {string} name - Name.
     * @param {string | number} value - Value to use.
     */
    constructor(name, value) {
        this.name = name;
        this.value = value;
    }
    getName() { return this.name; }
    getValue() { return this.value; }
    toString() { return `${this.getName()}: ${this.getValue()}`; }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGVhZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2h0dHAtY2xpZW50L2hlYWRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosTUFBTSxDQUFDLE9BQU8sT0FBTyxNQUFNO0lBQ3pCOzs7O09BSUc7SUFDSCxZQUFZLElBQUksRUFBRSxLQUFLO1FBQ3JCLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO0lBQ3BCLENBQUM7SUFFRCxPQUFPLEtBQUssT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFBLENBQUMsQ0FBQztJQUM5QixRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFBLENBQUMsQ0FBQztJQUNoQyxRQUFRLEtBQUssT0FBTyxHQUFHLElBQUksQ0FBQyxPQUFPLEVBQUUsS0FBSyxJQUFJLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQSxDQUFDLENBQUM7Q0FDOUQiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgSGVhZGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKi9cbiAgY29uc3RydWN0b3IobmFtZSwgdmFsdWUpIHtcbiAgICB0aGlzLm5hbWUgPSBuYW1lXG4gICAgdGhpcy52YWx1ZSA9IHZhbHVlXG4gIH1cblxuICBnZXROYW1lKCkgeyByZXR1cm4gdGhpcy5uYW1lIH1cbiAgZ2V0VmFsdWUoKSB7IHJldHVybiB0aGlzLnZhbHVlIH1cbiAgdG9TdHJpbmcoKSB7IHJldHVybiBgJHt0aGlzLmdldE5hbWUoKX06ICR7dGhpcy5nZXRWYWx1ZSgpfWAgfVxufVxuIl19