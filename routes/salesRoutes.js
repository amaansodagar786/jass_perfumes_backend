const express = require("express");
const router = express.Router();
const Sales = require("../models/salesModel");
const GlobalCounter = require("../models/globalCounter");

// Create new sales invoice
router.post("/create-sale", async (req, res) => {
  try {
    // Step 1: Generate Invoice number
    const counterId = "sales";
    let counter = await GlobalCounter.get(counterId);

    if (!counter) {
      counter = await GlobalCounter.create({ id: counterId, count: 1 });
    } else {
      counter = await GlobalCounter.update(
        { id: counterId },
        { count: counter.count + 1 }
      );
    }

    const newInvoiceNumber = `INV2025${String(counter.count).padStart(4, "0")}`;
    req.body.invoiceNumber = newInvoiceNumber; // Inject into request

    if (req.body.ewayBill) {
      req.body.ewayBill.docNo = newInvoiceNumber;
    }

    // Step 1.5: Add appliedAt timestamp to promo code if present
    if (req.body.appliedPromoCode) {
      req.body.appliedPromoCode.appliedAt = new Date().toISOString();
    }

    // Step 1.6: Calculate loyalty coins from frontend data
    const { baseValue, customer, appliedPromoCode, promoDiscount } = req.body;

    let loyaltyCoinsEarned = 0;
    if (baseValue && customer && customer.customerId) {
      // Calculate coins: 1 coin per 100 rupees, rounded down, max 50
      loyaltyCoinsEarned = Math.floor(baseValue / 100);
      loyaltyCoinsEarned = Math.min(loyaltyCoinsEarned, 50);

      // Add loyalty coins to the invoice data
      req.body.loyaltyCoinsEarned = loyaltyCoinsEarned;
    }

    // Step 2: Save the invoice
    const newSale = new Sales(req.body);
    await newSale.save();

    // Step 3: Update customer's loyalty coins in Customer collection
    if (loyaltyCoinsEarned > 0 && customer && customer.customerId) {
      try {
        // Find the customer and update their coins
        const customerToUpdate = await Customer.findOne({ customerId: customer.customerId });
        if (customerToUpdate) {
          customerToUpdate.loyaltyCoins = (customerToUpdate.loyaltyCoins || 0) + loyaltyCoinsEarned;
          await customerToUpdate.save();
          console.log(`Updated customer ${customer.customerId} with ${loyaltyCoinsEarned} loyalty coins. Total: ${customerToUpdate.loyaltyCoins}`);
        }
      } catch (customerError) {
        console.error("Failed to update customer loyalty coins:", customerError);
        // Don't fail the invoice creation if coin update fails
      }
    }

    // Step 4: Prepare success message with promo details if applicable
    let successMessage = "Invoice created successfully!";

    if (loyaltyCoinsEarned > 0) {
      successMessage += ` Customer earned ${loyaltyCoinsEarned} loyalty coins.`;
    }

    if (appliedPromoCode) {
      successMessage += ` Promo code "${appliedPromoCode.code}" applied with ${appliedPromoCode.discount}% discount.`;
    }

    res.status(201).json({
      success: true,
      message: successMessage,
      data: newSale
    });

  } catch (error) {
    console.error("Error creating sale:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create sale",
      error: error.message
    });
  }
});

// Get all sales invoices
router.get("/get-sales", async (req, res) => {
  try {
    const sales = await Sales.scan().exec();
    res.status(200).json({ success: true, data: sales });
  } catch (error) {
    console.error("Error fetching sales:", error);
    res.status(500).json({ success: false, message: "Failed to fetch sales" });
  }
});



// Get sales by work order number
router.get("/get-sales-by-wo", async (req, res) => {
  try {
    const { workOrderNumber } = req.query;
    if (!workOrderNumber) {
      return res.status(400).json({
        success: false,
        message: "Work Order Number is required"
      });
    }

    // Using scan instead of query since we might not have an index
    const sales = await Sales.scan("workOrderNumber").eq(workOrderNumber).exec();

    res.status(200).json({
      success: true,
      data: sales
    });
  } catch (error) {
    console.error("Error fetching sales by work orderr:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sales by work order",
      error: error.message
    });
  }
});


router.get("/get-sale/:invoiceNumber", async (req, res) => {
  try {
    const sale = await Sales.get(req.params.invoiceNumber);
    if (!sale) {
      return res.status(404).json({ success: false, message: "Sale not found" });
    }
    res.status(200).json({ success: true, data: sale });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error retrieving sale", error: error.message });
  }
});



// Update sale with image URL
router.put("/update-sale-image/:invoiceNumber", async (req, res) => {
  const { invoiceNumber } = req.params;
  const { imageUrl } = req.body;

  if (!imageUrl) {
    return res.status(400).json({
      success: false,
      message: "imageUrl is required"
    });
  }

  try {
    const updatedSale = await Sales.update(
      { invoiceNumber },
      { imageUrl }
    );

    res.status(200).json({
      success: true,
      message: "Image URL updated successfully",
      data: updatedSale
    });
  } catch (error) {
    console.error("Error updating sale image:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update sale image",
      error: error.message
    });
  }
});


// In your salesRoutes.js
router.put("/update-sale/:id", async (req, res) => {
  try {
    // Remove timestamp and other protected fields from update data
    const { createdAt, updatedAt, invoiceNumber, ...updateData } = req.body;

    // Make sure to include poNumber and poDate in the update
    const sale = await Sales.update(
      { invoiceNumber: req.params.id },
      updateData // This should include poNumber and poDate
    );

    res.status(200).json({
      success: true,
      data: sale
    });
  } catch (error) {
    console.error("Error updating sale:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update sale",
      error: error.message
    });
  }
});

router.delete("/delete-sale/:id", async (req, res) => {
  try {
    await Sales.delete({ invoiceNumber: req.params.id });
    res.status(200).json({
      success: true,
      message: "Sale deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting sale:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete sale",
      error: error.message
    });
  }
});




module.exports = router;
