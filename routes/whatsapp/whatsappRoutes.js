const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");

const Conversation = require("../../models/whatsapp/conversation");
const Message = require("../../models/whatsapp/message");
const Unsubscribe = require("../../models/whatsapp/unsubscribe");

// ========================================
// LOG FILE PATH
// ========================================
const LOG_FILE = "/tmp/whatsapp_webhook.log";

function writeLog(message, data = null) {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] ${message}`;
    if (data) {
        logEntry += `\n${JSON.stringify(data, null, 2)}`;
    }
    logEntry += `\n${"=".repeat(80)}\n`;
    fs.appendFileSync(LOG_FILE, logEntry);
    console.log(message);
}

// ========================================
// CREATE CONVERSATION
// ========================================
router.post("/create-conversation", async (req, res) => {
    try {
        const { customerName, customerPhone, customerProfilePic } = req.body;

        const existingConversation = await Conversation.findOne({ customerPhone });
        if (existingConversation) {
            return res.status(400).json({
                success: false,
                message: "Conversation already exists"
            });
        }

        const conversation = new Conversation({
            customerName,
            customerPhone,
            customerProfilePic
        });

        const savedConversation = await conversation.save();

        res.status(201).json({
            success: true,
            message: "Conversation created successfully",
            data: savedConversation
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Failed to create conversation",
            error: error.message
        });
    }
});

// ========================================
// GET ALL CONVERSATIONS
// ========================================
router.get("/get-conversations", async (req, res) => {
    try {
        const conversations = await Conversation.find({}).sort({ updatedAt: -1 });
        res.status(200).json({
            success: true,
            data: conversations
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch conversations",
            error: error.message
        });
    }
});

// ========================================
// SEND MESSAGE
// ========================================
router.post("/send-message", async (req, res) => {
    try {
        const { conversationId, customerPhone, message } = req.body;

        const whatsappResponse = await axios.post(
            `https://graph.facebook.com/v23.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: customerPhone,
                type: "text",
                text: { body: message }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const savedMessage = await Message.create({
            conversationId,
            senderType: "agent",
            messageType: "text",
            message,
            whatsappMessageId: whatsappResponse.data.messages[0].id,
            messageStatus: "sent"
        });

        await Conversation.findOneAndUpdate(
            { conversationId },
            {
                lastMessage: message,
                lastMessageTime: new Date()
            }
        );

        res.status(200).json({
            success: true,
            message: "Message sent successfully",
            data: savedMessage
        });

    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({
            success: false,
            message: "Failed to send message",
            error: error.response?.data || error.message
        });
    }
});

// ========================================
// GET MESSAGES
// ========================================
router.get("/get-messages/:conversationId", async (req, res) => {
    try {
        const messages = await Message.find({
            conversationId: req.params.conversationId
        }).sort({ createdAt: 1 });

        res.status(200).json({
            success: true,
            data: messages
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch messages",
            error: error.message
        });
    }
});

// ========================================
// RESET UNREAD COUNT
// ========================================
router.patch("/reset-unread/:conversationId", async (req, res) => {
    try {
        await Conversation.findOneAndUpdate(
            { conversationId: req.params.conversationId },
            { unreadCount: 0 }
        );
        res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Failed to reset unread count",
            error: error.message
        });
    }
});

// ========================================
// WEBHOOK VERIFICATION
// ========================================
router.get("/webhook/meta", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    writeLog("📞 WEBHOOK VERIFICATION GET REQUEST RECEIVED", {
        mode,
        token,
        challenge,
        expectedToken: process.env.WHATSAPP_VERIFY_TOKEN
    });

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        writeLog("✅ WEBHOOK VERIFIED SUCCESSFULLY");
        return res.status(200).send(challenge);
    }

    writeLog("❌ WEBHOOK VERIFICATION FAILED - Invalid token");
    return res.sendStatus(403);
});

router.post("/webhook/meta", async (req, res) => {
    writeLog("🚨🚨🚨 POST WEBHOOK CALLED 🚨🚨🚨");
    writeLog("📋 REQUEST HEADERS", req.headers);
    writeLog("📦 REQUEST BODY", req.body);
    res.sendStatus(200);
    writeLog("✅ Sent 200 response to Meta");
    try {
        const body = req.body;
        if (!body?.entry?.[0]?.changes?.[0]?.value) {
            writeLog("⚠️ No valid data in webhook payload");
            return;
        }
        const value = body.entry[0].changes[0].value;
        const message = value.messages?.[0];
        const status = value.statuses?.[0];
        writeLog("📨 Extracted from payload", { hasMessage: !!message, hasStatus: !!status });
        // ========================================
        // INCOMING CUSTOMER MESSAGE
        // ========================================
        if (message) {
            writeLog("🔄 PROCESSING INCOMING CUSTOMER MESSAGE");
            writeLog("📱 Raw message object", message);
            const customerPhone = message.from;
            let customerMessage = "";
            let messageType = "text";
            if (message.type === "text") {
                customerMessage = message.text?.body || "";
                messageType = "text";
            } else if (message.type === "image") {
                customerMessage = "📷 Image received";
                messageType = "image";
            } else if (message.type === "video") {
                customerMessage = "🎥 Video received";
                messageType = "video";
            } else if (message.type === "audio") {
                customerMessage = "🎵 Audio received";
                messageType = "audio";
            } else if (message.type === "document") {
                customerMessage = "📄 Document received";
                messageType = "document";
            } else if (message.type === "button") {
                customerMessage = message.button?.text || "Button clicked";
                messageType = "button";
            } else {
                customerMessage = `📨 ${message.type} message received`;
                messageType = message.type;
            }
            writeLog(`📞 Customer Phone: ${customerPhone}`);
            writeLog(`💬 Message: ${customerMessage}`);
            writeLog(`📎 Type: ${messageType}`);
            // ========================================
            // UNSUBSCRIBE DETECTION - CRITICAL!
            // ========================================
            const stopKeywords = ["stop", "unsubscribe", "unsub", "stop marketing", "stop promotions"];
            const isUnsubscribe = stopKeywords.some(keyword =>
                customerMessage.toLowerCase().includes(keyword)
            );
            if (isUnsubscribe) {
                writeLog(`🚨 UNSUBSCRIBE DETECTED for ${customerPhone}`);
                await Unsubscribe.findOneAndUpdate(
                    { phone: customerPhone },
                    {
                        phone: customerPhone,
                        reason: "STOP",
                        unsubscribedAt: new Date(),
                        isActive: true
                    },
                    { upsert: true }
                );
                writeLog(`✅ User ${customerPhone} added to unsubscribe list`);
                try {
                    await axios.post(
                        `https://graph.facebook.com/v23.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
                        {
                            messaging_product: "whatsapp",
                            to: customerPhone,
                            type: "text",
                            text: { body: "✅ You have been unsubscribed from marketing messages. You will still receive order updates and important notifications." }
                        },
                        {
                            headers: {
                                Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                                "Content-Type": "application/json"
                            }
                        }
                    );
                    writeLog(`📧 Sent unsubscribe confirmation to ${customerPhone}`);
                } catch (sendError) {
                    writeLog(`❌ Failed to send confirmation: ${sendError.message}`);
                }
            }
            // ========================================
            // BUTTON CLICK DETECTION
            // ========================================
            if (message.type === "button" && message.button?.text?.toLowerCase().includes("stop")) {
                writeLog(`🚨 STOP BUTTON CLICKED for ${customerPhone}`);
                await Unsubscribe.findOneAndUpdate(
                    { phone: customerPhone },
                    {
                        phone: customerPhone,
                        reason: "STOP_BUTTON",
                        unsubscribedAt: new Date(),
                        isActive: true
                    },
                    { upsert: true }
                );
                writeLog(`✅ User ${customerPhone} unsubscribed via STOP button`);
            }
            // ========================================
            // CONVERSATION HANDLING
            // ========================================
            let conversation = await Conversation.findOne({ customerPhone });
            if (!conversation) {
                writeLog("🆕 Creating new conversation...");
                conversation = new Conversation({
                    customerName: customerPhone,
                    customerPhone: customerPhone,
                    lastMessage: customerMessage,
                    lastMessageTime: new Date(),
                    unreadCount: 1
                });
                await conversation.save();
                writeLog(`✅ Conversation created with ID: ${conversation.conversationId}`);
            } else {
                writeLog(`✅ Existing conversation found: ${conversation.conversationId}`);
            }
            if (!isUnsubscribe) {
                writeLog("💾 Saving message to database...");
                const savedMessage = new Message({
                    conversationId: conversation.conversationId,
                    senderType: "customer",
                    messageType: messageType,
                    message: customerMessage,
                    whatsappMessageId: message.id,
                    messageStatus: "delivered"
                });
                await savedMessage.save();
                writeLog(`✅✅✅ MESSAGE SUCCESSFULLY SAVED! ID: ${savedMessage.messageId}`);
                const io = req.app.get('io');
                if (io) {
                    io.emit('new-message', {
                        conversationId: conversation.conversationId,
                        message: savedMessage,
                        customerPhone: customerPhone
                    });
                    writeLog("📡 Socket.io event emitted to frontend");
                }
                await Conversation.findOneAndUpdate(
                    { conversationId: conversation.conversationId },
                    {
                        lastMessage: customerMessage,
                        lastMessageTime: new Date(),
                        $inc: { unreadCount: 1 }
                    }
                );
                writeLog("✅ Conversation lastMessage updated");
            }
            writeLog("🎉 ========== MESSAGE PROCESSING COMPLETE ==========");
        }
        // ========================================
        // MESSAGE STATUS UPDATE
        // ========================================
        if (status) {
            writeLog("🔄 PROCESSING STATUS UPDATE");
            writeLog(`📊 Status: ${status.status} for message: ${status.id}`);
            writeLog(`📦 Full status object:`, status);

            const updateData = { messageStatus: status.status };

            if (status.errors && status.errors.length > 0) {
                updateData.errorCode = status.errors[0].code;
                updateData.errorMessage = status.errors[0].title;

                const errorLogEntry = `[${new Date().toISOString()}] FAILED MESSAGE\nPhone: ${status.recipient_id}\nCode: ${status.errors[0].code}\nReason: ${status.errors[0].title}\nMessage ID: ${status.id}\n${"=".repeat(80)}\n`;
                fs.appendFileSync("/tmp/whatsapp_failed_messages.log", errorLogEntry);

                writeLog(`❌ FAILED REASON — Code: ${status.errors[0].code} | Reason: ${status.errors[0].title}`);
            }

            await Message.findOneAndUpdate(
                { whatsappMessageId: status.id },
                updateData
            );

            writeLog("✅ Status updated successfully");
        }
    } catch (error) {
        writeLog("❌❌❌ CRITICAL WEBHOOK ERROR ❌❌❌");
        writeLog(`Error message: ${error.message}`);
        writeLog(`Error stack: ${error.stack}`);
        if (error.errors) {
            writeLog(`Validation errors:`, error.errors);
        }
        writeLog("========== ERROR LOG END ==========");
    }
});

module.exports = router;