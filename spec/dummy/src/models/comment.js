import CommentBase from "../model-bases/comment.js"

class Comment extends CommentBase {
}

Comment.belongsTo("task")

export default Comment
