const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
    messageId: {
        type: String,
        unique: true,
        default: () => require("uuid").v4(),
    },

    conversationId: {
        type: String,
        required: [true, "Conversation ID is required"]
    },

    senderType: {
        type: String,
        enum: ["customer", "agent"],
        required: [true, "Sender type is required"]
    },

    messageType: {
        type: String,
        enum: ["text", "image", "video", "document", "audio", "template"],
        default: "text"
    },

    message: {
        type: String,
        default: ""
    },

    mediaUrl: {
        type: String,
        default: ""
    },

    whatsappMessageId: {
        type: String,
        default: ""
    },

    messageStatus: {
        type: String,
        enum: ["sent", "delivered", "read", "failed"],
        default: "sent"
    },

    timestamp: {
        type: Date,
        default: Date.now
    }

}, {
    timestamps: true
});

messageSchema.index({ conversationId: 1 });

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;