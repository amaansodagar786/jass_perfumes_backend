const express = require("express");
const router = express.Router();
const User = require("../models/user");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// POST /register - Register new user
router.post("/register", async (req, res) => {
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
      return res.status(400).json({ 
        message: "Email already registered",
        field: "email"
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(req.body.password, salt);

    // Create new user
    const user = new User({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      password: hashedPassword
    });

    const savedUser = await user.save();

    // Create JWT token
    const token = jwt.sign(
      { userId: savedUser.userId },
      process.env.JWT_SECRET,
      { expiresIn: "10h" }
    );

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        userId: savedUser.userId,
        name: savedUser.name,
        email: savedUser.email,
        phone: savedUser.phone,
        permissions: savedUser.permissions || []
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

// POST /login - Authenticate user
router.post("/login", async (req, res) => {
  try {
    // Find user by email
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      return res.status(401).json({ 
        message: "Invalid credentials",
        field: "email"
      });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(req.body.password, user.password);
    if (!isMatch) {
      return res.status(401).json({ 
        message: "Invalid credentials",
        field: "password"
      });
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user.userId },
      process.env.JWT_SECRET,
      { expiresIn: "10h" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        permissions: user.permissions || [] 
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ 
      message: "Login failed", 
      error: error.message 
    });
  }
});

// GET /me - Get current user profile (protected route)
router.get("/me", async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ userId: decoded.userId });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        permissions: user.permissions || []
      }
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(401).json({ 
      message: "Invalid token", 
      error: error.message 
    });
  }
});

module.exports = router;