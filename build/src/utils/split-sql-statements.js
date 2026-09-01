// @ts-check
/**
 * Splits structure SQL into executable statements while keeping semicolons inside strings, identifiers, and comments intact.
 * @param {string} sql - SQL string.
 * @returns {string[]} - SQL statements.
 */
export default function splitSqlStatements(sql) {
    /** @type {string[]} */
    const statements = [];
    let current = "";
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (let index = 0; index < sql.length; index++) {
        const char = sql[index];
        const nextChar = sql[index + 1];
        const previousChar = sql[index - 1];
        current += char;
        if (inLineComment) {
            if (char == "\n")
                inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (previousChar == "*" && char == "/")
                inBlockComment = false;
            continue;
        }
        if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
            if (char == "-" && nextChar == "-") {
                inLineComment = true;
                continue;
            }
            if (char == "/" && nextChar == "*") {
                inBlockComment = true;
                continue;
            }
        }
        if (char == "'" && !inDoubleQuote && !inBacktick && previousChar != "\\") {
            if (inSingleQuote && nextChar == "'") {
                current += nextChar;
                index += 1;
            }
            else {
                inSingleQuote = !inSingleQuote;
            }
            continue;
        }
        if (char == "\"" && !inSingleQuote && !inBacktick && previousChar != "\\") {
            if (inDoubleQuote && nextChar == "\"") {
                current += nextChar;
                index += 1;
            }
            else {
                inDoubleQuote = !inDoubleQuote;
            }
            continue;
        }
        if (char == "`" && !inSingleQuote && !inDoubleQuote && previousChar != "\\") {
            inBacktick = !inBacktick;
            continue;
        }
        if (char == ";" && !inSingleQuote && !inDoubleQuote && !inBacktick) {
            const trimmed = current.trim();
            if (trimmed)
                statements.push(trimmed);
            current = "";
        }
    }
    const trimmed = current.trim();
    if (trimmed)
        statements.push(trimmed);
    return statements;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3BsaXQtc3FsLXN0YXRlbWVudHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvc3BsaXQtc3FsLXN0YXRlbWVudHMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsT0FBTyxVQUFVLGtCQUFrQixDQUFDLEdBQUc7SUFDNUMsdUJBQXVCO0lBQ3ZCLE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQTtJQUNyQixJQUFJLE9BQU8sR0FBRyxFQUFFLENBQUE7SUFDaEIsSUFBSSxhQUFhLEdBQUcsS0FBSyxDQUFBO0lBQ3pCLElBQUksYUFBYSxHQUFHLEtBQUssQ0FBQTtJQUN6QixJQUFJLFVBQVUsR0FBRyxLQUFLLENBQUE7SUFDdEIsSUFBSSxhQUFhLEdBQUcsS0FBSyxDQUFBO0lBQ3pCLElBQUksY0FBYyxHQUFHLEtBQUssQ0FBQTtJQUUxQixLQUFLLElBQUksS0FBSyxHQUFHLENBQUMsRUFBRSxLQUFLLEdBQUcsR0FBRyxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDO1FBQ2hELE1BQU0sSUFBSSxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN2QixNQUFNLFFBQVEsR0FBRyxHQUFHLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFBO1FBQy9CLE1BQU0sWUFBWSxHQUFHLEdBQUcsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUE7UUFFbkMsT0FBTyxJQUFJLElBQUksQ0FBQTtRQUVmLElBQUksYUFBYSxFQUFFLENBQUM7WUFDbEIsSUFBSSxJQUFJLElBQUksSUFBSTtnQkFBRSxhQUFhLEdBQUcsS0FBSyxDQUFBO1lBRXZDLFNBQVE7UUFDVixDQUFDO1FBRUQsSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUNuQixJQUFJLFlBQVksSUFBSSxHQUFHLElBQUksSUFBSSxJQUFJLEdBQUc7Z0JBQUUsY0FBYyxHQUFHLEtBQUssQ0FBQTtZQUU5RCxTQUFRO1FBQ1YsQ0FBQztRQUVELElBQUksQ0FBQyxhQUFhLElBQUksQ0FBQyxhQUFhLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNwRCxJQUFJLElBQUksSUFBSSxHQUFHLElBQUksUUFBUSxJQUFJLEdBQUcsRUFBRSxDQUFDO2dCQUNuQyxhQUFhLEdBQUcsSUFBSSxDQUFBO2dCQUNwQixTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxRQUFRLElBQUksR0FBRyxFQUFFLENBQUM7Z0JBQ25DLGNBQWMsR0FBRyxJQUFJLENBQUE7Z0JBQ3JCLFNBQVE7WUFDVixDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxDQUFDLGFBQWEsSUFBSSxDQUFDLFVBQVUsSUFBSSxZQUFZLElBQUksSUFBSSxFQUFFLENBQUM7WUFDekUsSUFBSSxhQUFhLElBQUksUUFBUSxJQUFJLEdBQUcsRUFBRSxDQUFDO2dCQUNyQyxPQUFPLElBQUksUUFBUSxDQUFBO2dCQUNuQixLQUFLLElBQUksQ0FBQyxDQUFBO1lBQ1osQ0FBQztpQkFBTSxDQUFDO2dCQUNOLGFBQWEsR0FBRyxDQUFDLGFBQWEsQ0FBQTtZQUNoQyxDQUFDO1lBQ0QsU0FBUTtRQUNWLENBQUM7UUFFRCxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksQ0FBQyxhQUFhLElBQUksQ0FBQyxVQUFVLElBQUksWUFBWSxJQUFJLElBQUksRUFBRSxDQUFDO1lBQzFFLElBQUksYUFBYSxJQUFJLFFBQVEsSUFBSSxJQUFJLEVBQUUsQ0FBQztnQkFDdEMsT0FBTyxJQUFJLFFBQVEsQ0FBQTtnQkFDbkIsS0FBSyxJQUFJLENBQUMsQ0FBQTtZQUNaLENBQUM7aUJBQU0sQ0FBQztnQkFDTixhQUFhLEdBQUcsQ0FBQyxhQUFhLENBQUE7WUFDaEMsQ0FBQztZQUNELFNBQVE7UUFDVixDQUFDO1FBRUQsSUFBSSxJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsYUFBYSxJQUFJLENBQUMsYUFBYSxJQUFJLFlBQVksSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUM1RSxVQUFVLEdBQUcsQ0FBQyxVQUFVLENBQUE7WUFDeEIsU0FBUTtRQUNWLENBQUM7UUFFRCxJQUFJLElBQUksSUFBSSxHQUFHLElBQUksQ0FBQyxhQUFhLElBQUksQ0FBQyxhQUFhLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNuRSxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUE7WUFFOUIsSUFBSSxPQUFPO2dCQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7WUFFckMsT0FBTyxHQUFHLEVBQUUsQ0FBQTtRQUNkLENBQUM7SUFDSCxDQUFDO0lBRUQsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFBO0lBRTlCLElBQUksT0FBTztRQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7SUFFckMsT0FBTyxVQUFVLENBQUE7QUFDbkIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFNwbGl0cyBzdHJ1Y3R1cmUgU1FMIGludG8gZXhlY3V0YWJsZSBzdGF0ZW1lbnRzIHdoaWxlIGtlZXBpbmcgc2VtaWNvbG9ucyBpbnNpZGUgc3RyaW5ncywgaWRlbnRpZmllcnMsIGFuZCBjb21tZW50cyBpbnRhY3QuXG4gKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gc3BsaXRTcWxTdGF0ZW1lbnRzKHNxbCkge1xuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBzdGF0ZW1lbnRzID0gW11cbiAgbGV0IGN1cnJlbnQgPSBcIlwiXG4gIGxldCBpblNpbmdsZVF1b3RlID0gZmFsc2VcbiAgbGV0IGluRG91YmxlUXVvdGUgPSBmYWxzZVxuICBsZXQgaW5CYWNrdGljayA9IGZhbHNlXG4gIGxldCBpbkxpbmVDb21tZW50ID0gZmFsc2VcbiAgbGV0IGluQmxvY2tDb21tZW50ID0gZmFsc2VcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgc3FsLmxlbmd0aDsgaW5kZXgrKykge1xuICAgIGNvbnN0IGNoYXIgPSBzcWxbaW5kZXhdXG4gICAgY29uc3QgbmV4dENoYXIgPSBzcWxbaW5kZXggKyAxXVxuICAgIGNvbnN0IHByZXZpb3VzQ2hhciA9IHNxbFtpbmRleCAtIDFdXG5cbiAgICBjdXJyZW50ICs9IGNoYXJcblxuICAgIGlmIChpbkxpbmVDb21tZW50KSB7XG4gICAgICBpZiAoY2hhciA9PSBcIlxcblwiKSBpbkxpbmVDb21tZW50ID0gZmFsc2VcblxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoaW5CbG9ja0NvbW1lbnQpIHtcbiAgICAgIGlmIChwcmV2aW91c0NoYXIgPT0gXCIqXCIgJiYgY2hhciA9PSBcIi9cIikgaW5CbG9ja0NvbW1lbnQgPSBmYWxzZVxuXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghaW5TaW5nbGVRdW90ZSAmJiAhaW5Eb3VibGVRdW90ZSAmJiAhaW5CYWNrdGljaykge1xuICAgICAgaWYgKGNoYXIgPT0gXCItXCIgJiYgbmV4dENoYXIgPT0gXCItXCIpIHtcbiAgICAgICAgaW5MaW5lQ29tbWVudCA9IHRydWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNoYXIgPT0gXCIvXCIgJiYgbmV4dENoYXIgPT0gXCIqXCIpIHtcbiAgICAgICAgaW5CbG9ja0NvbW1lbnQgPSB0cnVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNoYXIgPT0gXCInXCIgJiYgIWluRG91YmxlUXVvdGUgJiYgIWluQmFja3RpY2sgJiYgcHJldmlvdXNDaGFyICE9IFwiXFxcXFwiKSB7XG4gICAgICBpZiAoaW5TaW5nbGVRdW90ZSAmJiBuZXh0Q2hhciA9PSBcIidcIikge1xuICAgICAgICBjdXJyZW50ICs9IG5leHRDaGFyXG4gICAgICAgIGluZGV4ICs9IDFcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGluU2luZ2xlUXVvdGUgPSAhaW5TaW5nbGVRdW90ZVxuICAgICAgfVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PSBcIlxcXCJcIiAmJiAhaW5TaW5nbGVRdW90ZSAmJiAhaW5CYWNrdGljayAmJiBwcmV2aW91c0NoYXIgIT0gXCJcXFxcXCIpIHtcbiAgICAgIGlmIChpbkRvdWJsZVF1b3RlICYmIG5leHRDaGFyID09IFwiXFxcIlwiKSB7XG4gICAgICAgIGN1cnJlbnQgKz0gbmV4dENoYXJcbiAgICAgICAgaW5kZXggKz0gMVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaW5Eb3VibGVRdW90ZSA9ICFpbkRvdWJsZVF1b3RlXG4gICAgICB9XG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChjaGFyID09IFwiYFwiICYmICFpblNpbmdsZVF1b3RlICYmICFpbkRvdWJsZVF1b3RlICYmIHByZXZpb3VzQ2hhciAhPSBcIlxcXFxcIikge1xuICAgICAgaW5CYWNrdGljayA9ICFpbkJhY2t0aWNrXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChjaGFyID09IFwiO1wiICYmICFpblNpbmdsZVF1b3RlICYmICFpbkRvdWJsZVF1b3RlICYmICFpbkJhY2t0aWNrKSB7XG4gICAgICBjb25zdCB0cmltbWVkID0gY3VycmVudC50cmltKClcblxuICAgICAgaWYgKHRyaW1tZWQpIHN0YXRlbWVudHMucHVzaCh0cmltbWVkKVxuXG4gICAgICBjdXJyZW50ID0gXCJcIlxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHRyaW1tZWQgPSBjdXJyZW50LnRyaW0oKVxuXG4gIGlmICh0cmltbWVkKSBzdGF0ZW1lbnRzLnB1c2godHJpbW1lZClcblxuICByZXR1cm4gc3RhdGVtZW50c1xufVxuIl19