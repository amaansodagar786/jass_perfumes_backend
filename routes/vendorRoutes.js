// routes/vendorRoutes.js

const express = require("express");
const router = express.Router();
const Vendor = require("../models/vendor");

// POST /api/vendors - Create a new vendor
router.post("/create-vendors", async (req, res) => {
  try {
    const { email } = req.body;

    // Check if vendor with this email already exists
    const existingVendors = await Vendor.scan("email").eq(email).exec();

    if (existingVendors.count > 0) {
      return res.status(400).json({
        message: "Vendor with this email already exists",
        field: "email"
      });
    }

    const vendor = new Vendor(req.body);
    const savedVendor = await vendor.save();
    res.status(201).json(savedVendor);
  } catch (error) {
    console.error("Error creating vendor:", error);
    res.status(500).json({
      message: "Failed to create vendor",
      error: error.message
    });
  }
});

// GET /api/vendors - Get all vendors
router.get("/get-vendors", async (req, res) => {
  try {
    const vendors = await Vendor.scan().exec();
    res.status(200).json(vendors);
  } catch (error) {
    console.error("Error fetching vendors:", error);
    res.status(500).json({ message: "Failed to fetch vendors", error });
  }
});


router.put("/update-vendor/:id", async (req, res) => {
  try {
    // Remove ALL problematic fields
    const { vendorId, _id, createdAt, updatedAt, ...updateData } = req.body;

    const vendor = await Vendor.update(
      { vendorId: req.params.id }, // Use the ID from URL, not from body
      updateData
    );
    res.status(200).json(vendor);
  } catch (error) {
    console.error("Error updating vendor:", error);
    res.status(500).json({
      message: "Failed to update vendor",
      error: error.message
    });
  }
});

// DELETE delete-vendor/:id - Delete vendor
router.delete("/delete-vendor/:id", async (req, res) => {
  try {
    await Vendor.delete({ vendorId: req.params.id });
    res.status(200).json({ message: "Vendor deleted successfully" });
  } catch (error) {
    console.error("Error deleting vendor:", error);
    res.status(500).json({ message: "Failed to delete vendor", error });
  }
});


module.exports = router;
