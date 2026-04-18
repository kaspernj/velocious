import TaskBase from "../model-bases/task.js"

class Task extends TaskBase {
  /** @returns {string} - Computed frontend-model identifier. */
  identifier() {
    return `task-${this.id()}`
  }

  /** @returns {Promise<void>} - Appends a marker used by lifecycle callback tests. */
  async validateSomething() {
    this.assign({name: `${this.name()} validated-by-method`})
  }

  /** @returns {boolean | null} - Normalized boolean attribute. */
  isDone() {
    const value = super.isDone()

    if (value == null) return value

    return value === true || value === 1 || value === "1"
  }
}

Task.belongsTo("project", {counterCache: true})
Task.hasMany("interactions", {className: "Interaction", foreignKey: "subject_id", polymorphic: true})
Task.hasOne("primaryInteraction", {className: "Interaction", foreignKey: "subject_id", polymorphic: true})
Task.hasMany("comments")
Task.hasManyAttachments("files")
Task.hasOneAttachment("descriptionFile")
Task.validates("name", {presence: true, uniqueness: {scope: "projectId"}})

export default Task
