const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const inventorySchema = new mongoose.Schema({
  inventoryId: {
    type: String,
    unique: true,
    default: () => uuidv4(),
  },
  productId: {
    type: String,
    required: true,
    ref: 'Product',
  },
  productName: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  // ADD PRICE HISTORY ARRAY
  priceHistory: [{
    price: {
      type: Number,
      required: true,
      min: 0.01
    },
    quantityAdded: {
      type: Number,
      required: true,
      min: 1
    },
    batchNumbers: [{
      type: String,
      required: true
    }],
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
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
    manufactureDate: {
      type: Date,
      required: true
    },
    expiryDate: {
      type: Date,
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
    // NO PRICE IN BATCHES - price is at inventory level
  }],
  totalQuantity: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true,
});

// Create indexes for better query performance
inventorySchema.index({ productId: 1 });
inventorySchema.index({ productName: 1 });
inventorySchema.index({ category: 1 });

// Update totalQuantity when batches change
inventorySchema.pre('save', function (next) {
  this.totalQuantity = this.batches.reduce((total, batch) => total + batch.quantity, 0);
  next();
});

const Inventory = mongoose.model('Inventory', inventorySchema);
module.exports = Inventory;