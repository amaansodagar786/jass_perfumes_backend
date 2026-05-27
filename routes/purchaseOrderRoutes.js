// routes/purchaseOrderRoutes.js
const express = require("express");
const router = express.Router();
const PurchaseOrder = require("../models/purchaseOrderModel");
const GlobalCounter = require("../models/globalCounter");
const GRN = require("../models/grnModel"); // Import GRN model


// @desc    Create a new Purchase Order
// @route   POST /purchase-orders
router.post("/create-po", async (req, res) => {
  try {
    // Step 1: Get current counter
    const counterId = "purchaseOrder";
    let counter = await GlobalCounter.get(counterId);

    if (!counter) {
      counter = await GlobalCounter.create({ id: counterId, count: 1 });
    } else {
      counter = await GlobalCounter.update(
        { id: counterId },
        { count: counter.count + 1 }
      );
    }

    const newPONumber = `PO2025${String(counter.count).padStart(4, "0")}`;

    // Step 2: Create PO with new number
    const newPO = new PurchaseOrder({
      ...req.body,
      poNumber: newPONumber,
    });

    await newPO.save();
    res.status(201).json({
      success: true,
      message: "Purchase Order created successfully",
      data: newPO,
    });
  } catch (error) {
    console.error("Error saving purchase order:", error);
    res.status(500).json({
      success: false,
      message: "Error saving purchase order",
      error: error.message,
    });
  }
});

// @desc    Get all Purchase Orders
// @route   GET /purchase-orders
router.get("/get-pos", async (req, res) => {
  try {
    const allPOs = await PurchaseOrder.scan().exec();
    res.status(200).json({ success: true, data: allPOs });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchase orders", error: error.message });
  }
});

// @desc    Get Purchase Order by ID
// @route   GET /purchase-orders/:id
router.get("/get-po/:id", async (req, res) => {
  try {
    const po = await PurchaseOrder.get(req.params.id);
    if (!po) {
      return res.status(404).json({ success: false, message: "Purchase Order not found" });
    }
    res.status(200).json({ success: true, data: po });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error retrieving purchase order", error: error.message });
  }
});





// @desc    Update Purchase Order with uploaded PDF URL
// @route   PUT /purchase-orders/update-po-pdf/:poNumber
router.put("/update-po-pdf/:poNumber", async (req, res) => {
  const { poNumber } = req.params;
  const { pdfUrl } = req.body;

  if (!pdfUrl) {
    return res.status(400).json({ success: false, message: "pdfUrl is required" });
  }

  try {
    const existingPO = await PurchaseOrder.get(poNumber);

    if (!existingPO) {
      return res.status(404).json({ success: false, message: "Purchase Order not found" });
    }

    // Correct update
    await PurchaseOrder.update(
      { poNumber: poNumber },
      { pdfUrl: pdfUrl }
    );

    res.status(200).json({ success: true, message: "PDF URL updated" });
  } catch (error) {
    console.error("Error updating PO with pdfUrl:", error);
    res.status(500).json({ success: false, message: "Failed to update PO", error: error.message });
  }
});



// @desc    Update Purchase Order

// router.put("/update-po/:poNumber", async (req, res) => {
//   try {
//     const { poNumber } = req.params;

//     // Remove fields that shouldn't be updated
//     const { _id, createdAt, updatedAt, poNumber: ignore, ...updateData } = req.body;

//     const updatedPO = await PurchaseOrder.update(
//       { poNumber: poNumber },
//       updateData
//     );

//     res.status(200).json({
//       success: true,
//       message: "Purchase Order updated successfully",
//       data: updatedPO
//     });
//   } catch (error) {
//     console.error("Error updating purchase order:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to update purchase order",
//       error: error.message
//     });
//   }
// });


router.put("/update-po/:poNumber", async (req, res) => {
  try {
    const { poNumber } = req.params;
    const { poNumber: ignore, _id, createdAt, updatedAt, ...updateData } = req.body;

    // Check if GRNs exist for this PO before allowing item deletion
    const existingGRNs = await GRN.scan("poNumber").eq(poNumber).exec();

    if (existingGRNs.length > 0 && updateData.items) {
      // Check if any items being removed have GRNs
      const currentPO = await PurchaseOrder.get(poNumber);
      const currentItems = currentPO.items || [];
      const updatedItems = updateData.items;

      const receivedQuantities = {};
      existingGRNs.forEach(grn => {
        (grn.items || []).forEach(grnItem => {
          if (!receivedQuantities[grnItem.name]) {
            receivedQuantities[grnItem.name] = 0;
          }
          receivedQuantities[grnItem.name] += grnItem.qty || 0;
        });
      });

      // Check if any items being updated have quantities below received
      const itemsWithInsufficientQuantity = [];

      updatedItems.forEach(updatedItem => {
        const receivedQty = receivedQuantities[updatedItem.name] || 0;

        // If updated quantity is less than received quantity, it's invalid
        if (updatedItem.qty < receivedQty) {
          itemsWithInsufficientQuantity.push({
            name: updatedItem.name,
            requestedQty: updatedItem.qty,
            receivedQty: receivedQty
          });
        }
      });

      if (itemsWithInsufficientQuantity.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot reduce quantity below received quantity",
          items: itemsWithInsufficientQuantity.map(item => ({
            name: item.name,
            requestedQty: item.requestedQty,
            receivedQty: item.receivedQty
          }))
        });
      }

      // Find items that were removed
      const removedItems = currentItems.filter(currentItem =>
        !updatedItems.some(updatedItem => updatedItem.name === currentItem.name)
      );

      if (removedItems.length > 0) {
        // Check if any removed items have GRNs
        const grnItems = existingGRNs.flatMap(grn => grn.items || []);
        const removedItemsWithGRN = removedItems.filter(removedItem =>
          grnItems.some(grnItem => grnItem.name === removedItem.name)
        );

        if (removedItemsWithGRN.length > 0) {
          return res.status(400).json({
            success: false,
            message: `Cannot remove items that have GRNs created: ${removedItemsWithGRN.map(item => item.name).join(', ')}`
          });
        }
      }
    }

    const updatedPO = await PurchaseOrder.update(
      { poNumber: poNumber },
      updateData
    );

    res.status(200).json({
      success: true,
      message: "Purchase Order updated successfully",
      data: updatedPO
    });
  } catch (error) {
    console.error("Error updating purchase order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update purchase order",
      error: error.message
    });
  }
});

// @desc    Delete Purchase Order
// @route   DELETE /purchase-orders/delete-po/:poNumber
// router.delete("/delete-po/:poNumber", async (req, res) => {
//   try {
//     const { poNumber } = req.params;

//     await PurchaseOrder.delete({ poNumber: poNumber });

//     res.status(200).json({
//       success: true,
//       message: "Purchase Order deleted successfully"
//     });
//   } catch (error) {
//     console.error("Error deleting purchase order:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to delete purchase order",
//       error: error.message
//     });
//   }
// });


router.delete("/delete-po/:poNumber", async (req, res) => {
  try {
    const { poNumber } = req.params;

    // Check if GRNs exist for this PO
    const existingGRNs = await GRN.scan("poNumber").eq(poNumber).exec();

    if (existingGRNs.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete PO because GRN(s) have been created for it"
      });
    }

    await PurchaseOrder.delete({ poNumber: poNumber });

    res.status(200).json({
      success: true,
      message: "Purchase Order deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting purchase order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete purchase order",
      error: error.message
    });
  }
});

// In your routes/purchaseOrderRoutes.js - Update the check-items-grn route

// router.get("/check-items-grn/:poNumber", async (req, res) => {
//   try {
//     const { poNumber } = req.params;
//     const { itemNames } = req.query; // Change back to itemNames

//     console.log("Checking GRN for PO:", poNumber, "Items:", itemNames);

//     const itemNameArray = itemNames ? itemNames.split(',') : [];

//     // Find all GRNs for this PO - use the same query as update-po
//     const existingGRNs = await GRN.scan("poNumber").eq(poNumber).exec();

//     console.log("Found GRNs:", existingGRNs.length);

//     const itemsWithGRN = [];

//     // Use the SAME logic as the update-po endpoint
//     existingGRNs.forEach(grn => {
//       (grn.items || []).forEach(grnItem => {
//         // Check by item NAME (not ID) to match the update-po logic
//         if (itemNameArray.includes(grnItem.name) && !itemsWithGRN.includes(grnItem.name)) {
//           itemsWithGRN.push(grnItem.name);
//         }
//       });
//     });

//     console.log("Items with GRN:", itemsWithGRN);

//     res.status(200).json({
//       success: true,
//       itemsWithGRN
//     });
//   } catch (error) {
//     console.error("Error in check-items-grn:", error);
//     res.status(500).json({
//       success: false,
//       message: "Error checking GRN for items",
//       error: error.message
//     });
//   }
// });

// @desc    Check if GRN exists for a PO
router.get("/check-grn-for-po/:poNumber", async (req, res) => {
  try {
    const { poNumber } = req.params;

    const existingGRNs = await GRN.scan("poNumber").eq(poNumber).exec();

    res.status(200).json({
      success: true,
      hasGRN: existingGRNs.length > 0
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error checking GRN for PO",
      error: error.message
    });
  }
});


// routes/purchaseOrderRoutes.js - Update the check-items-grn route
router.get("/check-items-grn/:poNumber", async (req, res) => {
  try {
    const { poNumber } = req.params;
    const { itemNames } = req.query;

    console.log("Checking GRN for PO:", poNumber, "Items:", itemNames);

    const itemNameArray = itemNames ? itemNames.split(',') : [];
    const existingGRNs = await GRN.scan("poNumber").eq(poNumber).exec();

    console.log("Found GRNs:", existingGRNs.length);

    const itemsWithGRN = [];
    const itemGRNQuantities = {}; // Store quantities for all items

    // Calculate received quantities for all items
    existingGRNs.forEach(grn => {
      (grn.items || []).forEach(grnItem => {
        // Store quantity for ALL items, not just requested ones
        if (!itemGRNQuantities[grnItem.name]) {
          itemGRNQuantities[grnItem.name] = 0;
        }
        itemGRNQuantities[grnItem.name] += grnItem.qty || 0;

        // Check if this specific item is in our request list
        if (itemNameArray.includes(grnItem.name) && !itemsWithGRN.includes(grnItem.name)) {
          itemsWithGRN.push(grnItem.name);
        }
      });
    });

    console.log("Items with GRN:", itemsWithGRN);
    console.log("Item quantities:", itemGRNQuantities);

    res.status(200).json({
      success: true,
      itemsWithGRN,
      itemGRNQuantities // Return quantities for all items
    });
  } catch (error) {
    console.error("Error in check-items-grn:", error);
    res.status(500).json({
      success: false,
      message: "Error checking GRN for items",
      error: error.message
    });
  }
});


module.exports = router;