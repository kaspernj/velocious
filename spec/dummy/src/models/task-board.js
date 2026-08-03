import TaskBoardBase from "../model-bases/task-board.js"

class TaskBoard extends TaskBoardBase {
}

TaskBoard.belongsTo("project")
TaskBoard.hasMany("taskBoardCards")

export default TaskBoard
