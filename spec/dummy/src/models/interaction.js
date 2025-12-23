import InteractionBase from "../model-bases/interaction.js"

class Interaction extends InteractionBase {
}

Interaction.belongsTo("subject", {polymorphic: true})

export default Interaction
