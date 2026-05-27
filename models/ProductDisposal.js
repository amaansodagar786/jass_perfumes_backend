const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const productDisposalSchema = new mongoose.Schema({
  disposalId: {
    type: String,
    unique: true,
    default: () => uuidv4(),
  },
  productId: {
    type: String,
    required: true,
    ref: 'Product'
  },
  productName: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['defective', 'expired']
  },
  batches: [{
    batchNumber: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 0
    },
    manufactureDate: Date,
    expiryDate: Date
  }],
  reason: {
    type: String,
    required: function() {
      return this.type === 'defective';
    }
  },
  disposalDate: {
    type: Date,
    default: Date.now
  },
  totalQuantityDisposed: {
    type: Number,
    required: true,
    min: 0
  },
  disposedBy: {
    type: String,
    default: 'system' // You can integrate with user authentication later
  }
}, {
  timestamps: true
});

// Create indexes for better query performance
productDisposalSchema.index({ productId: 1 });
productDisposalSchema.index({ type: 1 });
productDisposalSchema.index({ disposalDate: 1 });

const ProductDisposal = mongoose.model('ProductDisposal', productDisposalSchema);
module.exports = ProductDisposal;