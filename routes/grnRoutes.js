const express = require("express");
const router = express.Router();
const GRN = require("../models/grnModel");
const Inventory = require("../models/inventory");
const GlobalCounter = require("../models/globalCounter");

// Create GRN
// router.post("/create-grn", async (req, res) => {
//   try {
//     const grnData = req.body;

//     for (const item of grnData.items) {
//       console.log("GRN Item received:", item);
//       const itemName = item.name;

//       if (!itemName) {
//         console.log("item name missing, skipping...");
//         continue;
//       }

//       const inventoryResult = await Inventory.scan("itemName").eq(itemName).exec();

//       if (inventoryResult.length === 0) {
//         console.log(`No inventory found for item: ${itemName}`);
//         continue;
//       }

//       const inventoryItem = inventoryResult[0];

//       const updatedTotalRate = (inventoryItem.totalRateSum || 0) + item.rate;
//       const updatedRateCount = (inventoryItem.rateCount || 0) + 1;
//       const updatedAveragePrice = updatedTotalRate / updatedRateCount;

//       await Inventory.update(
//         { inventoryId: inventoryItem.inventoryId },
//         {
//           $ADD: {
//             currentStock: item.qty,
//           },
//           totalRateSum: updatedTotalRate,
//           rateCount: updatedRateCount,
//           averagePrice: updatedAveragePrice,
//           lastUpdated: new Date(),
//         }
//       );

//       console.log(`Updated stock & average price for ${itemName}`);
//     }

//     const newGrn = new GRN(grnData);
//     await newGrn.save();

//     res.status(201).json({ success: true, message: "GRN created", data: newGrn });
//   } catch (error) {
//     console.error("Error saving GRN:", error);
//     res.status(500).json({ success: false, message: "Failed to save GRN" });
//   }
// });


router.post("/create-grn", async (req, res) => {
  try {
    const grnData = req.body;

    // Step 1: Generate GRN number from global counter
    const counterId = "grn";
    let counter = await GlobalCounter.get(counterId);

    if (!counter) {
      counter = await GlobalCounter.create({ id: counterId, count: 1 });
    } else {
      counter = await GlobalCounter.update(
        { id: counterId },
        { count: counter.count + 1 }
      );
    }

    const newGRNNumber = `GRN2025${String(counter.count).padStart(4, "0")}`;
    grnData.grnNumber = newGRNNumber; // Inject into GRN data

    // Step 2: Update Inventory stock (same logic as before)
    for (const item of grnData.items) {
      const itemName = item.name;
      if (!itemName) continue;

      const inventoryResult = await Inventory.scan("itemName").eq(itemName).exec();
      if (inventoryResult.length === 0) continue;

      const inventoryItem = inventoryResult[0];
      const updatedTotalRate = (inventoryItem.totalRateSum || 0) + item.rate;
      const updatedRateCount = (inventoryItem.rateCount || 0) + 1;
      const updatedAveragePrice = updatedTotalRate / updatedRateCount;

      await Inventory.update(
        { inventoryId: inventoryItem.inventoryId },
        {
          $ADD: {
            currentStock: item.qty,
          },
          totalRateSum: updatedTotalRate,
          rateCount: updatedRateCount,
          averagePrice: updatedAveragePrice,
          lastUpdated: new Date(),
        }
      );
    }

    // Step 3: Save GRN
    const newGrn = new GRN(grnData);
    await newGrn.save();

    res.status(201).json({ success: true, message: "GRN created", data: newGrn });
  } catch (error) {
    console.error("Error saving GRN:", error);
    res.status(500).json({ success: false, message: "Failed to save GRN" });
  }
});



// Get all GRNs
router.get("/get-grns", async (req, res) => {
  try {
    const grns = await GRN.scan().exec();
    res.status(200).json({ success: true, data: grns });
  } catch (err) {
    console.error("Error fetching GRNs:", err);
    res.status(500).json({ success: false, message: "Failed to fetch GRNs" });
  }
});



// Add this new route
router.get("/get-grns-by-po", async (req, res) => {
  try {
    const { poNumber } = req.query;
    if (!poNumber) return res.status(400).json({ error: "PO Number required" });

    // Use scan instead of query (slower but works without index)
    const grns = await GRN.scan("poNumber").eq(poNumber).exec();

    res.status(200).json({ success: true, data: grns });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// Update GRN (only allowed fields)
router.put("/update-grn/:id", async (req, res) => {
  try {
    const { lrNumber, transporter, vehicleNo, grnDate } = req.body;

    const grn = await GRN.update(
      { grnNumber: req.params.id },
      { lrNumber, transporter, vehicleNo, grnDate }
    );

    res.status(200).json({ success: true, data: grn });
  } catch (error) {
    console.error("Error updating GRN:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update GRN",
      error: error.message
    });
  }
});

// Delete GRN
router.delete("/delete-grn/:id", async (req, res) => {
  try {
    const grnNumber = req.params.id;

    // First get the GRN to know what items to deduct
    const grn = await GRN.get(grnNumber);
    if (!grn) {
      return res.status(404).json({ success: false, message: "GRN not found" });
    }

    // Deduct stock from inventory for each item
    for (const item of grn.items) {
      const itemName = item.name;
      if (!itemName) continue;

      const inventoryResult = await Inventory.scan("itemName").eq(itemName).exec();
      if (inventoryResult.length === 0) continue;

      const inventoryItem = inventoryResult[0];

      // Calculate new average price after removing this GRN's contribution
      const removedTotalValue = item.rate * item.qty;
      const newTotalRateSum = (inventoryItem.totalRateSum || 0) - removedTotalValue;
      const newRateCount = (inventoryItem.rateCount || 0) - item.qty;

      // Prevent negative values
      const safeNewTotalRateSum = Math.max(0, newTotalRateSum);
      const safeNewRateCount = Math.max(0, newRateCount);

      // Calculate new average price (avoid division by zero)
      const newAveragePrice = safeNewRateCount > 0 ? safeNewTotalRateSum / safeNewRateCount : 0;

      await Inventory.update(
        { inventoryId: inventoryItem.inventoryId },
        {
          $ADD: {
            currentStock: -item.qty, // Deduct the quantity
          },
          totalRateSum: safeNewTotalRateSum,
          rateCount: safeNewRateCount,
          averagePrice: newAveragePrice,
          lastUpdated: new Date(),
        }
      );
    }

    // Now delete the GRN
    await GRN.delete({ grnNumber: grnNumber });

    res.status(200).json({ success: true, message: "GRN deleted successfully" });
  } catch (error) {
    console.error("Error deleting GRN:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete GRN",
      error: error.message
    });
  }
});



module.exports = router;
