import CommentBase from "../model-bases/comment.js"

class Comment extends CommentBase {
}

Comment.belongsTo("task")
Comment.belongsTo("doneTask", (scope) => scope.where({isDone: true}), {className: "Task"})

export default Comment
