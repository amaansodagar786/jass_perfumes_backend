const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  customerId: {
    type: String,
    unique: true,
    default: () => require("uuid").v4(),
  },
  customerName: {
    type: String,
    required: [true, 'Customer name is required']
  },
  email: {
    type: String,
    // Email is optional based on your frontend validation
  },
  contactNumber: {
    type: String,
    required: [true, 'Contact number is required']
  },

  loyaltyCoins: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true // This will automatically add createdAt and updatedAt fields
});

// Create index for email for better query performance
customerSchema.index({ email: 1 });

const Customer = mongoose.model('Customer', customerSchema);

module.exports = Customer;