const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const FormData = require("form-data");
const Template = require("../../models/whatsapp/template");

// ========================================
// CONFIGURATION
// ========================================
const LOG_FILE = "./logs/whatsapp_templates.log";
const upload = multer({ dest: "./uploads/" });

if (!fs.existsSync("./logs")) fs.mkdirSync("./logs");
if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");
if (!fs.existsSync("./public/uploads")) fs.mkdirSync("./public/uploads", { recursive: true });

function writeLog(message, data = null) {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] ${message}`;
    if (data) logEntry += `\n${JSON.stringify(data, null, 2)}`;
    logEntry += `\n${"=".repeat(80)}\n`;
    fs.appendFileSync(LOG_FILE, logEntry);
    console.log(message);
}

const metaApiCall = async (method, url, data = null, isFormData = false) => {
    try {
        writeLog(`📡 META API CALL: ${method} ${url}`);
        const headers = {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        };
        if (!isFormData) headers["Content-Type"] = "application/json";
        const config = { method, url, headers };
        if (data) config.data = data;
        const response = await axios(config);
        writeLog(`✅ META API SUCCESS: ${method} ${url}`);
        return { success: true, data: response.data };
    } catch (error) {
        writeLog(`❌ META API ERROR: ${method} ${url}`);
        writeLog(`🚨 DETAILS:`, error.response?.data || error.message);
        return { success: false, error: error.response?.data || error.message };
    }
};

// ========================================
// 1. UPLOAD MEDIA (Supports Images & Videos)
// ========================================
router.post("/upload-media", upload.single("file"), async (req, res) => {
    writeLog("🚀 UPLOAD MEDIA");
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const file = req.file;
        const fileSize = fs.statSync(file.path).size;
        const fileType = file.mimetype;

        const validImageTypes = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
        const validVideoTypes = ["video/mp4", "video/3gpp"];
        const isValidImage = validImageTypes.includes(fileType);
        const isValidVideo = validVideoTypes.includes(fileType);

        if (!isValidImage && !isValidVideo) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ success: false, message: "Invalid file type. Only JPEG, PNG, WEBP images and MP4 videos are allowed" });
        }

        if (isValidImage && fileSize > 1.6 * 1024 * 1024) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ success: false, message: "Image size must be less than 1.6MB" });
        }
        if (isValidVideo && fileSize > 16 * 1024 * 1024) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ success: false, message: "Video size must be less than 16MB" });
        }

        const mediaType = isValidImage ? "image" : "video";

        const ext = path.extname(file.originalname) || (isValidImage ? ".jpg" : ".mp4");
        const uniqueFileName = `wa_${Date.now()}${ext}`;
        const publicPath = path.join(__dirname, "../../public/uploads", uniqueFileName);
        fs.copyFileSync(file.path, publicPath);
        const mediaUrl = `${process.env.BASE_URL}/api/uploads/${uniqueFileName}`;
        writeLog(`✅ Media saved publicly: ${mediaUrl}`);

        const sessionRes = await axios.post(
            `https://graph.facebook.com/v25.0/${process.env.META_APP_ID}/uploads`,
            null,
            {
                params: {
                    file_name: file.originalname,
                    file_length: fileSize,
                    file_type: fileType,
                    access_token: process.env.WHATSAPP_ACCESS_TOKEN,
                },
            }
        );

        const uploadSessionId = sessionRes.data.id;
        writeLog(`📡 Upload session created: ${uploadSessionId}`);

        const fileStream = fs.createReadStream(file.path);

        const uploadRes = await axios.post(
            `https://graph.facebook.com/v25.0/${uploadSessionId}`,
            fileStream,
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                    "Content-Type": fileType,
                    "file_offset": "0",
                },
            }
        );

        const mediaHandle = uploadRes.data.h;
        writeLog(`✅ Media handle obtained: ${mediaHandle}`);

        let mediaId = null;
        try {
            const formData = new FormData();
            formData.append("file", fs.createReadStream(file.path), {
                filename: file.originalname,
                contentType: fileType,
            });
            formData.append("type", fileType);
            formData.append("messaging_product", "whatsapp");

            const mediaUploadRes = await axios.post(
                `https://graph.facebook.com/v25.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                        ...formData.getHeaders(),
                    },
                }
            );

            mediaId = mediaUploadRes.data.id;
            writeLog(`✅ Numeric Media ID obtained: ${mediaId}`);
        } catch (mediaErr) {
            writeLog(`⚠️ Failed to get numeric media ID: ${mediaErr.message}`);
        }

        fs.unlinkSync(file.path);

        res.status(200).json({
            success: true,
            data: {
                media_handle: mediaHandle,
                media_id: mediaId,
                media_url: mediaUrl,
                media_type: mediaType,
                file_name: file.originalname,
            },
        });

    } catch (error) {
        writeLog(`🔥 ERROR in upload-media: ${error.message}`);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            message: "Upload failed",
            error: error.response?.data || error.message,
        });
    }
});

// ========================================
// 2. CREATE TEMPLATE (Supports TEXT, IMAGE, VIDEO headers + BUTTONS)
// ========================================
router.post("/create-template", async (req, res) => {
    writeLog("🚀 CREATE TEMPLATE");
    writeLog("📋 REQUEST BODY:", req.body);

    try {
        let {
            name,
            category = "UTILITY",
            language = "en",
            headerType = "NONE",
            headerText = null,
            headerMediaHandle = null,
            headerMediaId = null,
            headerImageUrl = null,
            bodyText,
            footerText = null,
            buttons = [],
        } = req.body;

        if (!name || !bodyText) {
            return res.status(400).json({ success: false, message: "Template name and body text are required" });
        }

        name = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");

        const components = [];

        // HEADER Section
        if (headerType !== "NONE") {
            if (headerType === "TEXT" && headerText) {
                components.push({
                    type: "HEADER",
                    format: "TEXT",
                    text: headerText,
                });
            } else if (headerType === "IMAGE" && headerMediaHandle) {
                components.push({
                    type: "HEADER",
                    format: "IMAGE",
                    example: {
                        header_handle: [headerMediaHandle],
                    },
                });
            } else if (headerType === "VIDEO" && headerMediaHandle) {
                components.push({
                    type: "HEADER",
                    format: "VIDEO",
                    example: {
                        header_handle: [headerMediaHandle],
                    },
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: `Invalid header configuration for type: ${headerType}`,
                });
            }
        }

        // BODY Section
        const bodyComponent = { type: "BODY", text: bodyText };
        const placeholders = bodyText.match(/\{\{(\d+)\}\}/g);
        if (placeholders && placeholders.length > 0) {
            const exampleValues = Array(placeholders.length).fill("example");
            bodyComponent.example = { body_text: [exampleValues] };
        }
        components.push(bodyComponent);

        // FOOTER Section
        if (footerText) {
            components.push({ type: "FOOTER", text: footerText });
        }

        // BUTTONS Section - CRITICAL for Opt-Out
        if (buttons && buttons.length > 0) {
            // For MARKETING templates, ensure STOP button exists
            let finalButtons = [...buttons];

            if (category === "MARKETING") {
                const hasStopButton = buttons.some(btn =>
                    btn.text?.toLowerCase() === "stop" ||
                    btn.text?.toLowerCase() === "unsubscribe" ||
                    btn.text?.toLowerCase() === "stop promotions"
                );

                if (!hasStopButton) {
                    finalButtons.push({
                        type: "QUICK_REPLY",
                        text: "Stop Promotions"
                    });
                    writeLog(`⚠️ Added STOP button to MARKETING template`);
                }
            }

            components.push({ type: "BUTTONS", buttons: finalButtons });
        } else if (category === "MARKETING") {
            // If no buttons provided but category is MARKETING, add STOP button automatically
            components.push({
                type: "BUTTONS",
                buttons: [
                    {
                        type: "QUICK_REPLY",
                        text: "Stop Promotions"
                    }
                ]
            });
            writeLog(`⚠️ Auto-added STOP button to MARKETING template`);
        }

        // Force category to MARKETING for media headers
        let effectiveCategory = category;
        if ((headerType === "IMAGE" || headerType === "VIDEO") && category !== "MARKETING") {
            effectiveCategory = "MARKETING";
            writeLog(`⚠️ ${headerType} template. Category changed to MARKETING`);
        }

        const templateData = {
            name,
            category: effectiveCategory,
            language,
            components,
        };

        writeLog("📤 SENDING TO META:", JSON.stringify(templateData, null, 2));

        const result = await metaApiCall(
            "POST",
            `https://graph.facebook.com/v25.0/${process.env.WHATSAPP_WABA_ID}/message_templates`,
            templateData
        );

        if (result.success) {
            writeLog(`✅ TEMPLATE CREATED: ${name}`);

            try {
                await Template.findOneAndUpdate(
                    { name: name },
                    {
                        name: name,
                        category: effectiveCategory,
                        language: language,
                        mediaHandle: headerMediaHandle || null,
                        mediaId: headerMediaId || null,
                        imageUrl: headerImageUrl || null,
                        components: components,
                        status: "PENDING",
                        metaId: result.data.id,
                    },
                    { upsert: true, new: true }
                );
                writeLog(`✅ Template saved to DB with buttons`);
            } catch (dbError) {
                writeLog(`⚠️ Failed to save template to DB: ${dbError.message}`);
            }

            res.status(201).json({
                success: true,
                message: "Template created successfully. Waiting for approval.",
                data: result.data,
            });
        } else {
            writeLog(`❌ TEMPLATE CREATION FAILED: ${name}`);
            res.status(400).json({
                success: false,
                message: "Failed to create template",
                error: result.error,
            });
        }
    } catch (error) {
        writeLog(`🔥 CRITICAL ERROR: ${error.message}`);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
});

// ========================================
// 3. GET ALL TEMPLATES
// ========================================
router.get("/get-templates", async (req, res) => {
    writeLog("🚀 GET ALL TEMPLATES");
    try {
        const { limit = 100 } = req.query;
        const url = `https://graph.facebook.com/v25.0/${process.env.WHATSAPP_WABA_ID}/message_templates?limit=${limit}`;
        const result = await metaApiCall("GET", url);
        if (result.success) {
            res.status(200).json({
                success: true,
                data: result.data.data || [],
                paging: result.data.paging || null,
            });
        } else {
            res.status(400).json({ success: false, message: "Failed to fetch templates", error: result.error });
        }
    } catch (error) {
        writeLog(`🔥 ERROR: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// 4. GET SINGLE TEMPLATE
// ========================================
router.get("/get-template/:name", async (req, res) => {
    writeLog(`🚀 GET TEMPLATE: ${req.params.name}`);
    try {
        const { name } = req.params;
        const result = await metaApiCall(
            "GET",
            `https://graph.facebook.com/v25.0/${process.env.WHATSAPP_WABA_ID}/message_templates?name=${name}`
        );
        if (result.success && result.data.data?.length > 0) {
            res.status(200).json({ success: true, data: result.data.data[0] });
        } else {
            res.status(404).json({ success: false, message: `Template '${name}' not found` });
        }
    } catch (error) {
        writeLog(`🔥 ERROR: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// 5. DELETE TEMPLATE
// ========================================
router.delete("/delete-template/:name", async (req, res) => {
    writeLog(`🚀 DELETE TEMPLATE: ${req.params.name}`);
    try {
        const { name } = req.params;
        const result = await metaApiCall(
            "DELETE",
            `https://graph.facebook.com/v25.0/${process.env.WHATSAPP_WABA_ID}/message_templates`,
            { name }
        );
        if (result.success) {
            await Template.deleteOne({ name: name });
            writeLog(`✅ Template deleted from database: ${name}`);
            res.status(200).json({ success: true, message: `Template '${name}' deleted successfully` });
        } else {
            res.status(400).json({ success: false, message: "Failed to delete template", error: result.error });
        }
    } catch (error) {
        writeLog(`🔥 ERROR: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// 6. GET TEMPLATE STATUS
// ========================================
router.get("/template-status/:name", async (req, res) => {
    writeLog(`🚀 TEMPLATE STATUS: ${req.params.name}`);
    try {
        const { name } = req.params;
        const result = await metaApiCall(
            "GET",
            `https://graph.facebook.com/v25.0/${process.env.WHATSAPP_WABA_ID}/message_templates?name=${name}`
        );
        if (result.success && result.data.data?.length > 0) {
            const template = result.data.data[0];
            res.status(200).json({
                success: true,
                name: template.name,
                status: template.status,
                statusMessage: getStatusMessage(template.status),
                data: template,
            });
        } else {
            res.status(404).json({ success: false, message: "Template not found" });
        }
    } catch (error) {
        writeLog(`🔥 ERROR: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// 7. GET TEMPLATE CATEGORIES
// ========================================
router.get("/template-categories", async (req, res) => {
    const categories = [
        { value: "UTILITY", label: "Utility - Order updates" },
        { value: "MARKETING", label: "Marketing - Promotions" },
        { value: "AUTHENTICATION", label: "Authentication - OTP" },
    ];
    res.status(200).json({ success: true, categories });
});

// ========================================
// HELPER
// ========================================
function getStatusMessage(status) {
    const messages = {
        APPROVED: "✅ Template is approved",
        PENDING: "⏳ Pending review",
        REJECTED: "❌ Template was rejected",
    };
    return messages[status] || "Unknown";
}

module.exports = router;