const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const userSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      unique: true,
      default: () => uuidv4(),
    },
    name: {
      type: String,
      required: [true, 'Name is required']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true
    },
    phone: {
      type: String,
      required: [true, 'Phone is required']
    },
    password: {
      type: String,
      required: [true, 'Password is required']
    },
    permissions: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: true
  }
);

// Create indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ userId: 1 });

const User = mongoose.model('User', userSchema);
module.exports = User;