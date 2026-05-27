const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const categorySchema = new mongoose.Schema(
  {
    categoryId: {
      type: String,
      unique: true,
      default: () => uuidv4(),
    },
    name: {
      type: String,
      required: [true, 'Category name is required'],
      unique: true,
      trim: true,
      lowercase: true
    }
  },
  {
    timestamps: true
  }
);

// Create indexes for better performance
categorySchema.index({ name: 1 });
categorySchema.index({ categoryId: 1 });

const Category = mongoose.model('Category', categorySchema);
module.exports = Category;