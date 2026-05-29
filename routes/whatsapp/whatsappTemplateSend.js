const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const Template = require("../../models/whatsapp/template");
const Unsubscribe = require("../../models/whatsapp/unsubscribe");
const WhatsappUser = require("../../models/whatsapp/whatsappUsers");
const Customer = require("../../models/customer");


const Conversation = require("../../models/whatsapp/conversation");
const Message = require("../../models/whatsapp/message");

const LOG_FILE = "./logs/whatsapp_send.log";

if (!fs.existsSync("./logs")) {
    fs.mkdirSync("./logs");
}

function writeLog(message, data = null) {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] ${message}`;
    if (data) logEntry += `\n${JSON.stringify(data, null, 2)}`;
    logEntry += `\n${"=".repeat(80)}\n`;
    fs.appendFileSync(LOG_FILE, logEntry);
    console.log(message);
}

function cleanPhoneNumber(phone) {
    const cleanPhone = phone.toString().replace(/\D/g, '');
    // Just return the cleaned number without adding any prefix
    return cleanPhone;
}

async function sendTemplateToCustomer(customerPhone, templateName, language = "en", parameters = [], headerParameter = null, headerType = null) {
    try {
        const requestData = {
            messaging_product: "whatsapp",
            to: customerPhone,
            type: "template",
            template: {
                name: templateName,
                language: { code: language }
            }
        };

        const components = [];

        if (headerParameter && headerType) {
            if (headerType === "IMAGE") {
                components.push({
                    type: "header",
                    parameters: [
                        {
                            type: "image",
                            image: {
                                id: headerParameter
                            }
                        }
                    ]
                });
            } else if (headerType === "VIDEO") {
                components.push({
                    type: "header",
                    parameters: [
                        {
                            type: "video",
                            video: {
                                id: headerParameter
                            }
                        }
                    ]
                });
            }
        }

        if (parameters && parameters.length > 0) {
            components.push({
                type: "body",
                parameters: parameters
            });
        }

        if (components.length > 0) {
            requestData.template.components = components;
        }

        const response = await axios.post(
            `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
            requestData,
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return {
            success: true,
            messageId: response.data.messages?.[0]?.id,
        };
    } catch (error) {
        return {
            success: false,
            error: error.response?.data || error.message
        };
    }
}

async function getOrCreateConversation(customerPhone) {
    let conversation = await Conversation.findOne({ customerPhone });

    if (!conversation) {
        conversation = new Conversation({
            customerName: customerPhone,
            customerPhone: customerPhone,
            lastMessage: "",
            lastMessageTime: new Date()
        });
        await conversation.save();
    }

    return conversation;
}

async function saveMessageToDB(conversationId, templateName, whatsappMessageId, status) {
    const message = new Message({
        conversationId: conversationId,
        senderType: "agent",
        messageType: "template",
        message: `Template: ${templateName}`,
        whatsappMessageId: whatsappMessageId,
        messageStatus: status
    });
    await message.save();
    return message;
}

// ========================================
// API: SAVE EXCEL DATA TO WHATSAPP USERS
// ========================================
router.post("/save-excel-users", async (req, res) => {
    writeLog("🚀 SAVE EXCEL USERS API CALLED");

    try {
        const { users } = req.body;

        if (!users || users.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No users to save"
            });
        }

        // Import Customer model at the top of the file

        const results = {
            saved: [],
            skipped: [],
            errors: []
        };

        for (const user of users) {
            try {
                const cleanPhone = cleanPhoneNumber(user.phone);

                // Validation 1: Check if phone number already exists in WhatsAppUsers
                const existingWhatsappUser = await WhatsappUser.findOne({ phone: cleanPhone });

                // Validation 2: Check if phone number already exists in Customer collection
                const existingCustomer = await Customer.findOne({ contactNumber: cleanPhone });

                if (existingWhatsappUser) {
                    results.skipped.push({
                        name: user.name,
                        phone: cleanPhone,
                        reason: "Phone number already exists in WhatsApp Users"
                    });
                }
                else if (existingCustomer) {
                    results.skipped.push({
                        name: user.name,
                        phone: cleanPhone,
                        reason: "Phone number already exists in Customer database"
                    });
                }
                else {
                    // No duplicate found, save the user
                    const newUser = new WhatsappUser({
                        name: user.name,
                        phone: cleanPhone,
                        source: "EXCEL_IMPORT"
                    });
                    await newUser.save();
                    results.saved.push({
                        name: user.name,
                        phone: cleanPhone
                    });
                }
            } catch (error) {
                results.errors.push({
                    name: user.name,
                    phone: user.phone,
                    reason: error.message
                });
            }
        }

        writeLog(`✅ Saved: ${results.saved.length}, Skipped: ${results.skipped.length}, Errors: ${results.errors.length}`);
        writeLog(`📝 Skipped details: ${JSON.stringify(results.skipped, null, 2)}`);
        writeLog(`❌ Error details: ${JSON.stringify(results.errors, null, 2)}`);

        res.status(200).json({
            success: true,
            message: `Saved ${results.saved.length} users, skipped ${results.skipped.length}, errors ${results.errors.length}`,
            data: results
        });

    } catch (error) {
        writeLog(`🔥 ERROR: ${error.message}`);
        res.status(500).json({
            success: false,
            message: "Failed to save users",
            error: error.message
        });
    }
});

// ========================================
// API: GET ALL WHATSAPP USERS
// ========================================
router.get("/get-whatsapp-users", async (req, res) => {
    writeLog("🚀 GET WHATSAPP USERS API CALLED");

    try {
        const users = await WhatsappUser.find({ isActive: true }).sort({ createdAt: -1 });

        // Format to match customer format for frontend
        const formattedUsers = users.map(user => ({
            customerId: user.userId,
            customerName: user.name,
            contactNumber: user.phone,
            source: user.source,
            importedAt: user.importedAt
        }));

        res.status(200).json({
            success: true,
            data: formattedUsers
        });

    } catch (error) {
        writeLog(`❌ ERROR: ${error.message}`);
        res.status(500).json({
            success: false,
            message: "Failed to fetch users",
            error: error.message
        });
    }
});

router.post("/send-to-customers", async (req, res) => {
    writeLog("🚀 SEND TEMPLATE TO CUSTOMERS API CALLED");

    try {
        const { customers, templateName, language = "en", parameters = [], headerParameter: customHeaderParameter } = req.body;

        if (!customers || customers.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Customers array is required"
            });
        }

        if (!templateName) {
            return res.status(400).json({
                success: false,
                message: "Template name is required"
            });
        }

        // Get template details
        let headerParameter = customHeaderParameter || null;
        let headerType = null;

        const templateRecord = await Template.findOne({ name: templateName });
        if (templateRecord) {
            const headerComponent = templateRecord.components?.find(c => c.type === "HEADER");
            if (headerComponent) {
                headerType = headerComponent.format;
            }
            if (!headerParameter && templateRecord.mediaId) {
                headerParameter = templateRecord.mediaId;
            }
        }

        // Prepare all customers with cleaned phone numbers
        const processedCustomers = [];
        for (const customer of customers) {
            const cleanPhone = cleanPhoneNumber(customer.phone);

            const unsubscribed = await Unsubscribe.findOne({
                $or: [
                    { phone: cleanPhone },
                    { phone: `91${cleanPhone}` },
                    { phone: cleanPhone.startsWith('91') ? cleanPhone.substring(2) : cleanPhone }
                ],
                isActive: true
            });

            processedCustomers.push({
                originalPhone: customer.phone,
                phone: cleanPhone,
                name: customer.name,
                isUnsubscribed: !!unsubscribed
            });
        }

        const validCustomers = processedCustomers.filter(c => !c.isUnsubscribed);
        const skippedUnsubscribed = processedCustomers.filter(c => c.isUnsubscribed);

        writeLog(`📊 Total: ${customers.length}, Valid: ${validCustomers.length}, Unsubscribed: ${skippedUnsubscribed.length}`);

        const BATCH_SIZE = 2;
        const BATCH_DELAY = 3000; // 3 seconds

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < validCustomers.length; i += BATCH_SIZE) {
            const batch = validCustomers.slice(i, i + BATCH_SIZE);
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(validCustomers.length / BATCH_SIZE);

            writeLog(`📦 Processing Batch ${batchNumber}/${totalBatches} (${batch.length} messages)`);

            // NO concurrency — one by one bhejo
            for (const customer of batch) {
                const sendResult = await sendTemplateToCustomer(
                    customer.phone,
                    templateName,
                    language,
                    parameters,
                    headerParameter,
                    headerType
                );

                if (sendResult.success) {
                    const conversation = await Conversation.findOneAndUpdate(
                        { customerPhone: customer.phone },
                        {
                            $setOnInsert: {
                                customerName: customer.name || customer.phone,
                                customerPhone: customer.phone,
                            },
                            $set: {
                                lastMessage: `Template: ${templateName}`,
                                lastMessageTime: new Date()
                            }
                        },
                        { upsert: true, new: true }
                    );

                    await saveMessageToDB(
                        conversation.conversationId,
                        templateName,
                        sendResult.messageId,
                        "sent"
                    );

                    successCount++;
                    results.push({ ...customer, success: true, messageId: sendResult.messageId });
                } else {
                    failCount++;
                    results.push({ ...customer, success: false, error: sendResult.error });
                }
            }

            // 3 second wait after each batch — last batch ke baad nahi
            if (i + BATCH_SIZE < validCustomers.length) {
                writeLog(`⏳ Waiting ${BATCH_DELAY}ms before next batch...`);
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
            }
        }

        // Add skipped unsubscribed users to results
        for (const skipped of skippedUnsubscribed) {
            results.push({
                ...skipped,
                success: false,
                skipped: true,
                reason: "User unsubscribed from marketing messages"
            });
        }

        const finalResults = {
            total: customers.length,
            valid: validCustomers.length,
            success: successCount,
            failed: failCount,
            skipped: skippedUnsubscribed.length,
            details: results
        };

        writeLog(`✅ COMPLETED: Success: ${successCount}, Failed: ${failCount}, Skipped: ${skippedUnsubscribed.length}`);

        res.status(200).json({
            success: true,
            message: `Sent to ${successCount} customers, failed: ${failCount}, skipped unsubscribed: ${skippedUnsubscribed.length}`,
            data: finalResults
        });

    } catch (error) {
        writeLog(`🔥 CRITICAL ERROR: ${error.message}`);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
});

router.post("/send-with-progress", async (req, res) => {
    writeLog("🚀 SEND WITH PROGRESS API CALLED");

    try {
        const { customers, templateName, language = "en", parameters = [], headerParameter: customHeaderParameter, socketId } = req.body;

        const io = req.app.get('io');

        if (!io) {
            return res.status(500).json({ success: false, message: "Socket.io not initialized" });
        }

        // Get template details
        let headerParameter = customHeaderParameter || null;
        let headerType = null;

        const templateRecord = await Template.findOne({ name: templateName });
        if (templateRecord) {
            const headerComponent = templateRecord.components?.find(c => c.type === "HEADER");
            if (headerComponent) headerType = headerComponent.format;
            if (!headerParameter && templateRecord.mediaId) headerParameter = templateRecord.mediaId;
        }

        // ✅ FIX: Bulk fetch all unsubscribed numbers in ONE DB call
        const allPhones = customers.map(c => cleanPhoneNumber(c.phone));
        const unsubscribedDocs = await Unsubscribe.find({
            phone: { $in: allPhones },
            isActive: true
        });
        const unsubscribedSet = new Set(unsubscribedDocs.map(u => u.phone));

        const results = [];
        let successCount = 0;
        let failCount = 0;
        let skippedCount = 0;

        for (let i = 0; i < customers.length; i++) {
            const customer = customers[i];
            const cleanPhone = cleanPhoneNumber(customer.phone);

            // ✅ FIX: Just check the Set — no DB call needed here anymore
            if (unsubscribedSet.has(cleanPhone)) {
                skippedCount++;
                results.push({ ...customer, success: false, reason: "Unsubscribed" });

                io.to(socketId).emit('send-progress', {
                    current: i + 1,
                    total: customers.length,
                    success: successCount,
                    failed: failCount,
                    skipped: skippedCount,
                    lastResult: { phone: customer.phone, status: "skipped", reason: "Unsubscribed" }
                });
                continue;
            }

            const sendResult = await sendTemplateToCustomer(
                cleanPhone, templateName, language, parameters, headerParameter, headerType
            );

            if (sendResult.success) {
                successCount++;
                results.push({ ...customer, success: true, messageId: sendResult.messageId });

                const conversation = await getOrCreateConversation(cleanPhone);
                await saveMessageToDB(conversation.conversationId, templateName, sendResult.messageId, "sent");
            } else {
                failCount++;
                results.push({ ...customer, success: false, error: sendResult.error });
            }

            io.to(socketId).emit('send-progress', {
                current: i + 1,
                total: customers.length,
                success: successCount,
                failed: failCount,
                skipped: skippedCount,
                lastResult: {
                    phone: customer.phone,
                    name: customer.name,
                    status: sendResult.success ? "success" : "failed",
                    error: sendResult.error
                }
            });

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        res.status(200).json({
            success: true,
            data: { total: customers.length, success: successCount, failed: failCount, skipped: skippedCount, results }
        });

    } catch (error) {
        writeLog(`🔥 ERROR: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
});
// ========================================
// API: GET APPROVED TEMPLATES
// ========================================
router.get("/get-approved-templates", async (req, res) => {
    writeLog("🚀 GET APPROVED TEMPLATES API CALLED");

    try {
        const response = await axios.get(
            `https://graph.facebook.com/v23.0/${process.env.WHATSAPP_WABA_ID}/message_templates`,
            {
                headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
            }
        );

        const allTemplates = response.data.data || [];
        const approvedTemplates = allTemplates.filter(t => t.status === "APPROVED");

        for (let i = 0; i < approvedTemplates.length; i++) {
            const template = approvedTemplates[i];
            const savedTemplate = await Template.findOne({ name: template.name });
            if (savedTemplate) {
                template.imageUrl = savedTemplate.imageUrl;
                template.mediaId = savedTemplate.mediaId;
                template.mediaHandle = savedTemplate.mediaHandle;
            }
        }

        res.status(200).json({ success: true, data: approvedTemplates });

    } catch (error) {
        writeLog(`❌ ERROR: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// API: GET UNSUBSCRIBED USERS
// ========================================
router.get("/get-unsubscribed", async (req, res) => {
    try {
        const unsubscribed = await Unsubscribe.find({ isActive: true }).sort({ unsubscribedAt: -1 });
        res.status(200).json({ success: true, data: unsubscribed });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// API: RE-SUBSCRIBE USER
// ========================================
router.post("/resubscribe", async (req, res) => {
    try {
        const { phone } = req.body;
        const result = await Unsubscribe.findOneAndUpdate(
            { phone: phone },
            { isActive: false },
            { new: true }
        );
        res.status(200).json({ success: true, message: result ? "User resubscribed" : "User not found" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// WEBHOOK
// ========================================
router.get("/webhook", (req, res) => {
    const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN || "your_verification_token_here";
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === verifyToken) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

router.post("/webhook", async (req, res) => {
    try {
        const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (message && message.type === "text") {
            const customerPhone = message.from;
            const messageText = message.text?.body?.toLowerCase();

            const stopKeywords = ["stop", "unsubscribe", "unsub", "stop marketing"];
            const isUnsubscribe = stopKeywords.some(keyword => messageText?.includes(keyword));

            if (isUnsubscribe) {
                await Unsubscribe.findOneAndUpdate(
                    { phone: customerPhone },
                    { phone: customerPhone, reason: "STOP", unsubscribedAt: new Date(), isActive: true },
                    { upsert: true }
                );
            }
        }
    } catch (error) {
        writeLog(`❌ Webhook error: ${error.message}`);
    }

    res.sendStatus(200);
});

module.exports = router;