import StringSubjectInteractionBase from "../model-bases/string-subject-interaction.js"

class StringSubjectInteraction extends StringSubjectInteractionBase {}

StringSubjectInteraction.belongsTo("subject", {polymorphic: true})

export default StringSubjectInteraction
