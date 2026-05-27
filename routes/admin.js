const express = require('express');
const router = express.Router();
const User = require("../models/user");
const Category = require("../models/category");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const auth = require('../routes/auth');

// Get all users (admin only)
router.get('/users', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.permissions || !req.user.permissions.includes('admin')) {
      return res.status(403).json({ message: 'Access denied. Admin required.' });
    }

    const users = await User.find({}).sort({ createdAt: -1 });

    // Convert to plain objects and remove passwords
    const usersWithoutPasswords = users.map(user => {
      const userObj = user.toObject();
      delete userObj.password;
      return userObj;
    });

    res.json(usersWithoutPasswords);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Register new user (admin only)
router.post('/register', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.permissions || !req.user.permissions.includes('admin')) {
      return res.status(403).json({ message: 'Access denied. Admin required.' });
    }

    const { name, email, phone, password, permissions } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        message: "Email already registered",
        field: "email"
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const user = new User({
      name,
      email,
      phone,
      password: hashedPassword,
      permissions: permissions || []
    });

    const savedUser = await user.save();

    // Remove password from response
    const userResponse = savedUser.toObject();
    delete userResponse.password;

    res.status(201).json({
      message: "User registered successfully",
      user: {
        userId: userResponse.userId,
        name: userResponse.name,
        email: userResponse.email,
        phone: userResponse.phone,
        permissions: userResponse.permissions,
        createdAt: userResponse.createdAt
      }
    });
  } catch (error) {
    console.error("Registration error:", error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: "Validation error",
        error: error.message
      });
    }

    res.status(500).json({
      message: "Registration failed",
      error: error.message
    });
  }
});

// uPDATE user (admin only)
router.put('/users/:userId', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.permissions || !req.user.permissions.includes('admin')) {
      return res.status(403).json({ message: 'Access denied. Admin required.' });
    }

    const { userId } = req.params;
    const { name, email, phone, permissions, password } = req.body;

    // Find user
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if target user is admin (prevent admin from updating other admin passwords)
    if (password && user.permissions && user.permissions.includes('admin')) {
      return res.status(403).json({
        message: 'Cannot update password for admin users'
      });
    }

    // Check if email is already taken by another user
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser && existingUser.userId !== userId) {
        return res.status(400).json({
          message: "Email already taken by another user",
          field: "email"
        });
      }
    }

    // Update user fields
    user.name = name || user.name;
    user.email = email || user.email;
    user.phone = phone || user.phone;
    user.permissions = permissions || user.permissions;

    // Update password if provided (only for non-admin users)
    if (password && password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }

    const updatedUser = await user.save();

    // Remove password from response
    const userResponse = updatedUser.toObject();
    delete userResponse.password;

    res.json({
      message: "User updated successfully",
      user: {
        userId: userResponse.userId,
        name: userResponse.name,
        email: userResponse.email,
        phone: userResponse.phone,
        permissions: userResponse.permissions,
        createdAt: userResponse.createdAt,
        updatedAt: userResponse.updatedAt
      }
    });
  } catch (error) {
    console.error("Update error:", error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: "Validation error",
        error: error.message
      });
    }

    res.status(500).json({
      message: "Update failed",
      error: error.message
    });
  }
});

// Delete user (admin only)
router.delete('/users/:userId', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.permissions || !req.user.permissions.includes('admin')) {
      return res.status(403).json({ message: 'Access denied. Admin required.' });
    }

    const { userId } = req.params;

    // Prevent admin from deleting themselves
    if (userId === req.user.userId) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    // Delete user
    const deletedUser = await User.findOneAndDelete({ userId });

    if (!deletedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({
      message: "Delete failed",
      error: error.message
    });
  }
});

// Category Management Routes

// Get all categories
router.get('/categories', async (req, res) => {
  try {
    // Check if user is admin
    // if (!req.user.permissions || !req.user.permissions.includes('admin')) {
    //   return res.status(403).json({ message: 'Access denied. Admin required.' });
    // }

    const categories = await Category.find({}).sort({ createdAt: -1 });
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create single category
router.post('/categories', auth, async (req, res) => {
  try {
    // Check if user is admin
    // if (!req.user.permissions || !req.user.permissions.includes('admin')) {
    //   return res.status(403).json({ message: 'Access denied. Admin required.' });
    // }

    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: "Category name is required",
        field: "name"
      });
    }

    // Convert to lowercase and trim
    const categoryName = name.trim().toLowerCase();

    // Check if category already exists
    const existingCategory = await Category.findOne({ name: categoryName });
    if (existingCategory) {
      return res.status(400).json({
        message: "Category already exists",
        field: "name"
      });
    }

    // Create new category
    const category = new Category({
      name: categoryName
    });

    const savedCategory = await category.save();

    res.status(201).json({
      message: "Category created successfully",
      category: savedCategory
    });
  } catch (error) {
    console.error("Category creation error:", error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: "Validation error",
        error: error.message
      });
    }

    res.status(500).json({
      message: "Category creation failed",
      error: error.message
    });
  }
});

// Create multiple categories at once
router.post('/categories/bulk', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.permissions || !req.user.permissions.includes('admin')) {
      return res.status(403).json({ message: 'Access denied. Admin required.' });
    }

    const { categories } = req.body;

    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({
        message: "Categories array is required and must not be empty"
      });
    }

    const results = {
      successful: [],
      failed: []
    };

    // Process each category
    for (const categoryData of categories) {
      try {
        const { name } = categoryData;

        if (!name || !name.trim()) {
          results.failed.push({
            name: name || 'undefined',
            error: "Category name is required"
          });
          continue;
        }

        // Convert to lowercase and trim
        const categoryName = name.trim().toLowerCase();

        // Check if category already exists
        const existingCategory = await Category.findOne({ name: categoryName });
        if (existingCategory) {
          results.failed.push({
            name: categoryName,
            error: "Category already exists"
          });
          continue;
        }

        // Create new category
        const category = new Category({
          name: categoryName
        });

        const savedCategory = await category.save();
        results.successful.push(savedCategory);

      } catch (error) {
        results.failed.push({
          name: categoryData.name || 'undefined',
          error: error.message
        });
      }
    }

    res.status(201).json({
      message: "Bulk category creation completed",
      results
    });
  } catch (error) {
    console.error("Bulk category creation error:", error);
    res.status(500).json({
      message: "Bulk category creation failed",
      error: error.message
    });
  }
});

// Update category
router.put('/categories/:categoryId', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.permissions || !req.user.permissions.includes('admin')) {
      return res.status(403).json({ message: 'Access denied. Admin required.' });
    }

    const { categoryId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: "Category name is required",
        field: "name"
      });
    }

    // Convert to lowercase and trim
    const categoryName = name.trim().toLowerCase();

    // Find category
    const category = await Category.findOne({ categoryId });
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // Check if new name already exists (excluding current category)
    const existingCategory = await Category.findOne({
      name: categoryName,
      categoryId: { $ne: categoryId }
    });
    if (existingCategory) {
      return res.status(400).json({
        message: "Category name already exists",
        field: "name"
      });
    }

    // Update category
    category.name = categoryName;
    const updatedCategory = await category.save();

    res.json({
      message: "Category updated successfully",
      category: updatedCategory
    });
  } catch (error) {
    console.error("Category update error:", error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: "Validation error",
        error: error.message
      });
    }

    res.status(500).json({
      message: "Category update failed",
      error: error.message
    });
  }
});

// Delete category
router.delete('/categories/:categoryId', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.permissions || !req.user.permissions.includes('admin')) {
      return res.status(403).json({ message: 'Access denied. Admin required.' });
    }

    const { categoryId } = req.params;

    // Delete category
    const deletedCategory = await Category.findOneAndDelete({ categoryId });

    if (!deletedCategory) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    console.error("Category delete error:", error);
    res.status(500).json({
      message: "Category delete failed",
      error: error.message
    });
  }
});

module.exports = router;