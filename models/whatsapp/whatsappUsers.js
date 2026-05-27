const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const whatsappUsersSchema = new mongoose.Schema({
    userId: {
        type: String,
        unique: true,
        default: uuidv4,
    },
    name: {
        type: String,
        required: [true, "Name is required"],
        trim: true,
    },
    phone: {
        type: String,
        required: [true, "Phone number is required"],
        unique: true,
        trim: true,
    },
    source: {
        type: String,
        enum: ["EXCEL_IMPORT", "MANUAL", "API"],
        default: "EXCEL_IMPORT",
    },
    importedAt: {
        type: Date,
        default: Date.now,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
}, {
    timestamps: true,
});

whatsappUsersSchema.index({ phone: 1 });
whatsappUsersSchema.index({ name: 1 });

const WhatsappUser = mongoose.model("WhatsappUser", whatsappUsersSchema);

module.exports = WhatsappUser;