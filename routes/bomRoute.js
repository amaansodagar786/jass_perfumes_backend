// routes/bomRoutes.js
const express = require("express");
const router = express.Router();
const BOM = require("../models/bomModel");
const GlobalCounter = require("../models/globalCounter");

// Create BOM with auto-generated ID
router.post("/create-bom", async (req, res) => {
  try {
    // Generate BOM ID
    const counterId = "bom";
    let counter = await GlobalCounter.get(counterId);

    if (!counter) {
      counter = await GlobalCounter.create({ id: counterId, count: 1 });
    } else {
      counter = await GlobalCounter.update(
        { id: counterId },
        { count: counter.count + 1 }
      );
    }

    const bomId = `BOM${String(counter.count).padStart(4, "0")}`;
    const bomData = { ...req.body, bomId };
    
    const newBOM = new BOM(bomData);
    await newBOM.save();
    
    res.status(201).json({ success: true, data: newBOM });
  } catch (error) {
    console.error("Error creating BOM:", error);
    res.status(500).json({ success: false, message: "Failed to create BOM" });
  }
});

// Get all BOMs
router.get("/get-boms", async (req, res) => {
  try {
    const boms = await BOM.scan().exec();
    res.status(200).json({ success: true, data: boms });
  } catch (error) {
    console.error("Error fetching BOMs:", error);
    res.status(500).json({ success: false, message: "Failed to fetch BOMs" });
  }
});

// Update BOM (only allowed fields)
router.put("/update-bom/:id", async (req, res) => {
  try {
    const { productName, description, hsnCode, items } = req.body;
    
    const bom = await BOM.update(
      { bomId: req.params.id },
      { productName, description, hsnCode, items }
    );
    
    res.status(200).json({ success: true, data: bom });
  } catch (error) {
    console.error("Error updating BOM:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update BOM", 
      error: error.message 
    });
  }
});

// Delete BOM
router.delete("/delete-bom/:id", async (req, res) => {
  try {
    await BOM.delete({ bomId: req.params.id });
    res.status(200).json({ success: true, message: "BOM deleted successfully" });
  } catch (error) {
    console.error("Error deleting BOM:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to delete BOM", 
      error: error.message 
    });
  }
});

module.exports = router;