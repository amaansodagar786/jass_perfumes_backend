const mongoose = require("mongoose");

const deletedInvoiceSchema = new mongoose.Schema(
  {
    originalInvoiceNumber: {
      type: String,
      required: true,
    },
    deletedAt: {
      type: Date,
      default: Date.now
    },
    deletedBy: {
      type: String,
      default: "system"
    },
    // Store the complete original invoice data
    invoiceData: {
      type: Object,
      required: true
    },
    // Stock restoration details
    stockRestoration: {
      restored: {
        type: Boolean,
        default: false
      },
      restoredAt: Date,
      itemsStockDetails: [{
        productId: String,
        productName: String,
        batchNumber: String,
        quantityRestored: Number,
        beforeDeletionStock: Number,
        afterRestorationStock: Number
      }]
    }
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("DeletedInvoice", deletedInvoiceSchema);