const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const templateSchema = new mongoose.Schema({
    templateId: {
        type: String,
        unique: true,
        default: uuidv4,
    },
    name: {
        type: String,
        required: true,
        unique: true,
    },
    category: {
        type: String,
        enum: ["UTILITY", "MARKETING", "AUTHENTICATION"],
        default: "UTILITY",
    },
    language: {
        type: String,
        default: "en",
    },
    mediaHandle: {
        type: String,
        default: null,
    },
    mediaId: {
        type: String,
        default: null,
    },
    imageUrl: {
        type: String,
        default: null,
    },
    components: {
        type: Array,
        default: [],
    },
    status: {
        type: String,
        enum: ["APPROVED", "PENDING", "REJECTED", "DRAFT"],
        default: "DRAFT",
    },
    metaId: {
        type: String,
        default: null,
    },
}, {
    timestamps: true,
});

templateSchema.index({ name: 1 });

const Template = mongoose.model("Template", templateSchema);

module.exports = Template;