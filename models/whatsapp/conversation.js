const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema({
    conversationId: {
        type: String,
        unique: true,
        default: () => require("uuid").v4(),
    },

    customerName: {
        type: String,
        required: [true, "Customer name is required"]
    },

    customerPhone: {
        type: String,
        required: [true, "Customer phone is required"]
    },

    customerProfilePic: {
        type: String,
        default: ""
    },

    lastMessage: {
        type: String,
        default: ""
    },

    lastMessageTime: {
        type: Date,
        default: Date.now
    },

    unreadCount: {
        type: Number,
        default: 0
    },

    isBlocked: {
        type: Boolean,
        default: false
    },

    isArchived: {
        type: Boolean,
        default: false
    }

}, {
    timestamps: true
});

conversationSchema.index({ customerPhone: 1 });

const Conversation = mongoose.model("Conversation", conversationSchema);

module.exports = Conversation;