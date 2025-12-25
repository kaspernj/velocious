import UuidInteractionBase from "../model-bases/uuid-interaction.js"

class UuidInteraction extends UuidInteractionBase {
}

UuidInteraction.belongsTo("subject", {polymorphic: true})

export default UuidInteraction
