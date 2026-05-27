const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const unsubscribeSchema = new mongoose.Schema({
    unsubscribeId: {
        type: String,
        unique: true,
        default: uuidv4,
    },
    phone: {
        type: String,
        required: true,
        unique: true,
    },
    reason: {
        type: String,
        enum: ["STOP", "UNSUBSCRIBE", "HELP", "MANUAL"],
        default: "STOP",
    },
    unsubscribedAt: {
        type: Date,
        default: Date.now,
    },
    templateName: {
        type: String,
        default: null,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
}, {
    timestamps: true,
});

unsubscribeSchema.index({ phone: 1 });

const Unsubscribe = mongoose.model("Unsubscribe", unsubscribeSchema);

module.exports = Unsubscribe;