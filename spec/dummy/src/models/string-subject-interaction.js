import DatabaseRecord from "../../../../src/database/record/index.js"

class StringSubjectInteraction extends DatabaseRecord {}

StringSubjectInteraction.belongsTo("subject", {polymorphic: true})

export default StringSubjectInteraction
