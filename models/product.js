const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const productSchema = new mongoose.Schema({
  productId: {
    type: String,
    unique: true,
    default: () => uuidv4(),
  },
  productName: {
    type: String,
    required: [true, 'Product name is required'],
    index: true
  },
  barcode: {
    type: String,
  },
  hsnCode: {
    type: String,
  },
  price: {
    type: Number,
  },
  taxSlab: {
    type: Number,
  },
  discount: {
    type: Number,
    default: 0, // Default discount is 0%
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    index: true
  },
}, {
  timestamps: true,
});

// Create indexes for better query performance
productSchema.index({ productName: 1 });
productSchema.index({ category: 1 });

// ✅ Use cached model if already compiled
const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

module.exports = Product;
