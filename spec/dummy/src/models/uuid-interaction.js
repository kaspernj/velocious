import DatabaseRecord from "../../../../src/database/record/index.js"

class UuidInteraction extends DatabaseRecord {}

UuidInteraction.belongsTo("subject", {polymorphic: true})

export default UuidInteraction
