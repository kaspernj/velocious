import TaskBoardCardBase from "../model-bases/task-board-card.js"

class TaskBoardCard extends TaskBoardCardBase {
}

TaskBoardCard.belongsTo("taskBoard")
TaskBoardCard.belongsTo("task")

export default TaskBoardCard
