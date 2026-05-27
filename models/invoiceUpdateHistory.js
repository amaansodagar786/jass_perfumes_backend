const mongoose = require('mongoose');

const fieldChangeSchema = new mongoose.Schema({
    field: String,
    oldValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed,
    fieldType: String // 'customer', 'payment', 'remarks'
}, { _id: false });

// ✅ NEW: Schema for item changes
const itemChangeSchema = new mongoose.Schema({
    productId: String,
    productName: String,
    batchNumber: String,
    quantity: Number,
    price: Number,
    taxSlab: Number,
    discount: Number
}, { _id: false });

// ✅ NEW: Schema for modified item fields
const modifiedFieldSchema = new mongoose.Schema({
    field: String,
    oldValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed
}, { _id: false });

// ✅ NEW: Schema for modified items
const modifiedItemSchema = new mongoose.Schema({
    productId: String,
    productName: String,
    batchNumber: String,
    changes: [modifiedFieldSchema]
}, { _id: false });

const invoiceUpdateHistorySchema = new mongoose.Schema({
    updateId: {
        type: String,
        unique: true,
        required: true
    },
    originalInvoiceNumber: {
        type: String,
        required: true,
        index: true
    },
    updatedBy: {
        userId: String,
        name: String,
        email: String
    },

    // Track all field changes (customer, payment, remarks)
    fieldChanges: [fieldChangeSchema],

    // ✅ NEW: Track all item-related changes
    itemsChanges: {
        added: [itemChangeSchema],
        removed: [itemChangeSchema],
        modified: [modifiedItemSchema]
    },

    // Financial changes
    financialChanges: {
        oldTotal: Number,
        newTotal: Number,
        oldSubtotal: Number,
        newSubtotal: Number,
        oldDiscount: Number,
        newDiscount: Number,
        difference: Number
    },

    // Summary of changes
    summary: {
        changesCount: Number,
        hasCustomerChanges: Boolean,
        hasPaymentChanges: Boolean,
        hasRemarksChanges: Boolean,
        hasItemChanges: Boolean,      // ✅ NEW
        hasFinancialChanges: Boolean   // ✅ NEW
    },

    status: {
        type: String,
        enum: ['SUCCESS', 'FAILED', 'PARTIAL'],
        default: 'SUCCESS'
    },
    errorDetails: String,
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes for better query performance
invoiceUpdateHistorySchema.index({ originalInvoiceNumber: 1, timestamp: -1 });
invoiceUpdateHistorySchema.index({ 'updatedBy.userId': 1 });
invoiceUpdateHistorySchema.index({ timestamp: -1 });

module.exports = mongoose.model('InvoiceUpdateHistory', invoiceUpdateHistorySchema);