const express = require("express");
const router = express.Router();
const WorkOrder = require("../models/workorderModel");
const Inventory = require("../models/inventory");
const BOM = require("../models/bomModel");
const GlobalCounter = require("../models/globalCounter");
const Sales = require("../models/salesModel");


const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const withRetry = async (operation, maxRetries = 3, baseDelay = 100) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (error.__type?.includes('ProvisionedThroughputExceededException')) {
        if (i === maxRetries - 1) throw error;
        await delay(baseDelay * Math.pow(2, i)); // Exponential backoff
        continue;
      }
      throw error;
    }
  }
};

router.post("/create-workorder", async (req, res) => {
  try {
    console.log("📩 Received Work Order Data:", req.body);
    const { items } = req.body;

    // Step 1: Generate Work Order number
    const counterId = "workorder";
    let counter = await GlobalCounter.get(counterId);

    if (!counter) {
      counter = await GlobalCounter.create({ id: counterId, count: 1 });
    } else {
      counter = await GlobalCounter.update(
        { id: counterId },
        { count: counter.count + 1 }
      );
    }

    const newWorkOrderNumber = `WO2025${String(counter.count).padStart(4, "0")}`;
    req.body.workOrderNumber = newWorkOrderNumber;

    // Step 2: Validate inventory using BOM ID
    for (const item of items) {
      // CORRECTED: Use BOM.get() with the bomId (not scanning by productName)
      if (!item.bomId) {
        return res.status(400).json({
          success: false,
          message: `BOM ID is missing for item: ${item.name || 'Unknown item'}`,
        });
      }

      const productBOM = await BOM.get(item.bomId);

      if (!productBOM) {
        return res.status(400).json({
          success: false,
          message: `BOM not found for ID: ${item.bomId}`,
        });
      }

      for (const bomItem of productBOM.items) {
        const inventoryResult = await Inventory.scan()
          .filter("itemName")
          .eq(bomItem.itemName)
          .exec();
        if (inventoryResult.length === 0) {
          return res.status(400).json({
            success: false,
            message: `Inventory item not found: ${bomItem.itemName}`,
          });
        }

        const inventoryItem = inventoryResult[0];
        const totalNeeded = bomItem.requiredQty * item.quantity;

        if ((inventoryItem.currentStock || 0) < totalNeeded) {
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for "${bomItem.itemName}". Required: ${totalNeeded}, Available: ${inventoryItem.currentStock}`,
          });
        }
      }
    }

    // Step 3: Save work order
    const newWorkOrder = new WorkOrder(req.body);
    await newWorkOrder.save();

    // Step 4: Update inventory using BOM ID
    for (const item of items) {
      const productBOM = await BOM.get(item.bomId);

      for (const bomItem of productBOM.items) {
        const inventoryResult = await Inventory.scan()
          .filter("itemName")
          .eq(bomItem.itemName)
          .exec(); const inventoryItem = inventoryResult[0];

        const totalUsed = bomItem.requiredQty * item.quantity;
        const updatedStock = (inventoryItem.currentStock || 0) - totalUsed;
        const updatedInUse = (inventoryItem.inUse || 0) + totalUsed;

        await Inventory.update(
          { inventoryId: inventoryItem.inventoryId },
          {
            currentStock: updatedStock,
            inUse: updatedInUse,
            lastUpdated: new Date(),
          }
        );
      }
    }

    res.status(201).json({
      success: true,
      message: "Work order created and inventory updated",
      data: newWorkOrder,
    });

  } catch (error) {
    console.error("Error creating work order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create work order",
      error: error.message,
    });
  }
});

// Get all work orders
router.get("/get-workorders", async (req, res) => {
  try {
    const workOrders = await WorkOrder.scan().exec();
    res.status(200).json({
      success: true,
      data: workOrders
    });
  } catch (error) {
    console.error("Error fetching work order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch work orders",
      error: error.message
    });
  }
});

// Get single work order by ID
router.get("/get-workorder/:id", async (req, res) => {
  try {
    const workOrder = await WorkOrder.get(req.params.id);
    if (!workOrder) {
      return res.status(404).json({
        success: false,
        message: "Work order not found"
      });
    }
    res.status(200).json({
      success: true,
      data: workOrder
    });
  } catch (error) {
    console.error("Error fetching work order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch work order",
      error: error.message
    });
  }
});

// In your server routes (workorderRoutes.js)
router.put("/update-workorder/:workOrderNumber", async (req, res) => {
  try {
    const { items, ...otherFields } = req.body;
    const { workOrderNumber } = req.params;

    // Get the existing work order with retry
    const existingWorkOrder = await withRetry(() =>
      WorkOrder.get(workOrderNumber)
    );

    if (!existingWorkOrder) {
      return res.status(404).json({
        success: false,
        message: "Work order not found"
      });
    }

    // Check sales for this work order - Using scan with filter and retry
    const existingSales = await withRetry(() =>
      Sales.scan()
        .filter("workOrderNumber")
        .eq(workOrderNumber)
        .exec()
    );

    // Calculate total quantities already sold for each BOM ID
    const soldQuantities = new Map();
    existingSales.forEach(sale => {
      sale.items?.forEach(item => {
        if (item.bomId) {
          const currentQty = soldQuantities.get(item.bomId) || 0;
          soldQuantities.set(item.bomId, currentQty + (item.quantity || 0));
        }
      });
    });

    // Validate that new quantities are not below sold quantities
    for (const newItem of items) {
      if (!newItem.bomId) {
        return res.status(400).json({
          success: false,
          message: `BOM ID is missing for item: ${newItem.name || 'Unknown item'}`,
        });
      }

      const alreadySold = soldQuantities.get(newItem.bomId) || 0;

      // If trying to reduce below what's already sold
      if (newItem.quantity < alreadySold) {
        return res.status(400).json({
          success: false,
          message: `Cannot reduce quantity of "${newItem.name}" to ${newItem.quantity} because ${alreadySold} units have already been sold`,
          details: {
            productName: newItem.name,
            requestedQuantity: newItem.quantity,
            soldQuantity: alreadySold,
            bomId: newItem.bomId
          }
        });
      }
    }

    // Create a map of existing items by BOM ID for easy comparison
    const existingItemsMap = new Map();
    existingWorkOrder.items.forEach(item => {
      if (item.bomId) {
        existingItemsMap.set(item.bomId, item);
      }
    });

    // Create a map of new items by BOM ID
    const newItemsMap = new Map();
    items.forEach(item => {
      if (item.bomId) {
        newItemsMap.set(item.bomId, item);
      }
    });

    // Identify removed items and calculate inventory changes for them
    const removedItems = [];
    for (const [bomId, existingItem] of existingItemsMap) {
      if (!newItemsMap.has(bomId)) {
        removedItems.push(existingItem);
      }
    }

    // Validate inventory for new/updated items and calculate changes
    const inventoryChanges = new Map(); // itemName -> change amount

    // First, process removed items to restore inventory
    for (const removedItem of removedItems) {
      const productBOM = await withRetry(() => BOM.get(removedItem.bomId));
      if (!productBOM) {
        return res.status(400).json({
          success: false,
          message: `BOM not found for ID: ${removedItem.bomId} (removed item)`,
        });
      }

      // For each component in the BOM, calculate the inventory to restore
      for (const bomItem of productBOM.items) {
        const totalToRestore = bomItem.requiredQty * removedItem.quantity;

        if (inventoryChanges.has(bomItem.itemName)) {
          inventoryChanges.set(bomItem.itemName,
            inventoryChanges.get(bomItem.itemName) + totalToRestore);
        } else {
          inventoryChanges.set(bomItem.itemName, totalToRestore);
        }
      }
    }

    // Then process new/updated items
    for (const newItem of items) {
      const productBOM = await withRetry(() => BOM.get(newItem.bomId));
      if (!productBOM) {
        return res.status(400).json({
          success: false,
          message: `BOM not found for ID: ${newItem.bomId}`,
        });
      }

      // Check if this item existed in the original order
      const existingItem = existingItemsMap.get(newItem.bomId);
      const oldQuantity = existingItem ? existingItem.quantity : 0;
      const quantityDifference = newItem.quantity - oldQuantity;

      // For each component in the BOM, calculate the change needed
      for (const bomItem of productBOM.items) {
        const totalChange = bomItem.requiredQty * quantityDifference;

        if (inventoryChanges.has(bomItem.itemName)) {
          inventoryChanges.set(bomItem.itemName,
            inventoryChanges.get(bomItem.itemName) - totalChange); // Subtract because we're calculating net change
        } else {
          inventoryChanges.set(bomItem.itemName, -totalChange); // Negative means we need to add to inventory
        }

        // Check if we have enough inventory for the change (only if we're consuming more)
        if (totalChange > 0) {
          const inventoryResult = await withRetry(() =>
            Inventory.scan()
              .filter("itemName")
              .eq(bomItem.itemName)
              .exec()
          );

          if (inventoryResult.length === 0) {
            return res.status(400).json({
              success: false,
              message: `Inventory item not found: ${bomItem.itemName}`,
            });
          }

          const inventoryItem = inventoryResult[0];
          if ((inventoryItem.currentStock || 0) < totalChange) {
            return res.status(400).json({
              success: false,
              message: `Insufficient stock for "${bomItem.itemName}". Required: ${totalChange}, Available: ${inventoryItem.currentStock}`,
            });
          }
        }
      }
    }

    // Apply inventory changes with retry
    for (const [itemName, change] of inventoryChanges) {
      const inventoryResult = await withRetry(() =>
        Inventory.scan()
          .filter("itemName")
          .eq(itemName)
          .exec()
      );

      if (inventoryResult.length === 0) continue;

      const inventoryItem = inventoryResult[0];
      
      // Positive change means we need to restore inventory (add to currentStock, subtract from inUse)
      // Negative change means we need to consume inventory (subtract from currentStock, add to inUse)
      const updatedStock = (inventoryItem.currentStock || 0) + change;
      const updatedInUse = (inventoryItem.inUse || 0) - change;

      await withRetry(() =>
        Inventory.update(
          { inventoryId: inventoryItem.inventoryId },
          {
            currentStock: updatedStock,
            inUse: updatedInUse,
            lastUpdated: new Date(),
          }
        )
      );
    }

    // Update the work order with retry
    const updatedWorkOrder = await withRetry(() =>
      WorkOrder.update(
        { workOrderNumber: workOrderNumber },
        { ...otherFields, items }
      )
    );

    res.status(200).json({
      success: true,
      data: updatedWorkOrder
    });
  } catch (error) {
    console.error("Error updating work order:", error);

    if (error.__type?.includes('ProvisionedThroughputExceededException')) {
      return res.status(429).json({
        success: false,
        message: "Database is busy. Please try again in a moment.",
        error: "Throughput exceeded"
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update work order",
      error: error.message
    });
  }
});

// Get sales by work order number
// router.get("/get-sales-by-workorder/:workOrderNumber", async (req, res) => {
//   try {
//     const { workOrderNumber } = req.params;

//     const sales = await Sales.scan()
//       .filter("workOrderNumber")
//       .eq(workOrderNumber)
//       .exec();

//     res.status(200).json({
//       success: true,
//       data: sales
//     });
//   } catch (error) {
//     console.error("Error fetching sales by work order:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch sales data",
//       error: error.message
//     });
//   }
// });

router.delete("/delete-workorder/:workOrderNumber", async (req, res) => {
  try {

    const { workOrderNumber } = req.params;

    // Check if work order has sales
    const existingSales = await Sales.scan("workOrderNumber").eq(workOrderNumber).exec();

    if (existingSales.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete work order because it has associated sales"
      });
    }

    const workOrder = await WorkOrder.get(req.params.workOrderNumber);

    if (!workOrder) {
      return res.status(404).json({
        success: false,
        message: "Work order not found"
      });
    }

    // Restore inventory for each item
    for (const item of workOrder.items) {
      if (!item.bomId) {
        console.warn(`BOM ID missing for item in work order: ${req.params.workOrderNumber}`);
        continue;
      }

      const productBOM = await BOM.get(item.bomId);
      if (!productBOM) {
        console.warn(`BOM not found for ID: ${item.bomId} when deleting work order`);
        continue;
      }

      for (const bomItem of productBOM.items) {
        const inventoryResult = await Inventory.scan()
          .filter("itemName")
          .eq(bomItem.itemName)
          .exec(); if (inventoryResult.length === 0) {
            console.warn(`Inventory item not found: ${bomItem.itemName} when deleting work order`);
            continue;
          }

        const inventoryItem = inventoryResult[0];
        const totalToRestore = bomItem.requiredQty * item.quantity;

        const updatedStock = (inventoryItem.currentStock || 0) + totalToRestore;
        const updatedInUse = Math.max(0, (inventoryItem.inUse || 0) - totalToRestore);

        await Inventory.update(
          { inventoryId: inventoryItem.inventoryId },
          {
            currentStock: updatedStock,
            inUse: updatedInUse,
            lastUpdated: new Date(),
          }
        );
      }
    }

    // Delete the work order
    await WorkOrder.delete({ workOrderNumber: req.params.workOrderNumber });

    res.status(200).json({
      success: true,
      message: "Work order deleted and inventory restored successfully"
    });
  } catch (error) {
    console.error("Error deleting work order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete work order",
      error: error.message
    });
  }
});

// Add this route to check if a work order is connected to sales
router.get("/check-sales-for-workorder/:workOrderNumber", async (req, res) => {
  try {
    const { workOrderNumber } = req.params;

    // Check if this work order exists in any sales
    const existingSales = await Sales.scan()
      .filter("workOrderNumber")
      .eq(workOrderNumber)
      .exec();
    res.status(200).json({
      success: true,
      hasSales: existingSales.length > 0
    });
  } catch (error) {
    console.error("Error checking sales for work order:", error);
    res.status(500).json({
      success: false,
      message: "Error checking sales connection",
      error: error.message
    });
  }
});

// In salesRoutes.js or similar
// router.get("/check-sales-for-product-in-workorder/:workOrderNumber/:bomId", async (req, res) => {
//   try {
//     const { workOrderNumber, bomId } = req.params;
//     const { restoreInventory = false, quantityToRestore = 0 } = req.query;

//     // Check if this work order exists in any sales with this specific BOM ID
//     const existingSales = await Sales.scan()
//       .filter("workOrderNumber")
//       .eq(workOrderNumber)
//       .exec();

//     // Check if any of these sales contain the specific BOM ID
//     const hasSales = existingSales.some(sale =>
//       sale.items?.some(item => item.bomId === bomId)
//     );

//     // If product has sales, return error
//     if (hasSales) {
//       return res.status(400).json({
//         success: false,
//         hasSales: true,
//         message: "Cannot remove product because it has associated sales"
//       });
//     }

//     // If restoreInventory flag is true and no sales, restore the inventory
//     if (restoreInventory === "true" && quantityToRestore > 0) {
//       // Get the BOM for this product
//       const productBOM = await BOM.get(bomId);

//       if (!productBOM) {
//         return res.status(404).json({
//           success: false,
//           message: `BOM not found for ID: ${bomId}`
//         });
//       }

//       // Restore inventory for each component in the BOM
//       for (const bomItem of productBOM.items) {
//         const inventoryResult = await Inventory.scan()
//           .filter("itemName")
//           .eq(bomItem.itemName)
//           .exec();

//         if (inventoryResult.length === 0) {
//           console.warn(`Inventory item not found: ${bomItem.itemName}`);
//           continue;
//         }

//         const inventoryItem = inventoryResult[0];
//         const totalToRestore = bomItem.requiredQty * quantityToRestore;

//         const updatedStock = (inventoryItem.currentStock || 0) + totalToRestore;
//         const updatedInUse = Math.max(0, (inventoryItem.inUse || 0) - totalToRestore);

//         await Inventory.update(
//           { inventoryId: inventoryItem.inventoryId },
//           {
//             currentStock: updatedStock,
//             inUse: updatedInUse,
//             lastUpdated: new Date(),
//           }
//         );
//       }

//       return res.status(200).json({
//         success: true,
//         hasSales: false,
//         message: "Inventory restored successfully",
//         inventoryRestored: true
//       });
//     }

//     // If no sales and no restore requested, just return the check result
//     res.status(200).json({
//       success: true,
//       hasSales: false,
//       message: "Product can be removed"
//     });

//   } catch (error) {
//     console.error("Error checking sales for product in work order:", error);
//     res.status(500).json({
//       success: false,
//       message: "Error checking sales connection",
//       error: error.message
//     });
//   }
// });


router.get("/check-sales-for-product-in-workorder/:workOrderNumber/:bomId", async (req, res) => {
  try {
    const { workOrderNumber, bomId } = req.params;

    // Check if this work order exists in any sales with this specific BOM ID
    const existingSales = await Sales.scan()
      .filter("workOrderNumber")
      .eq(workOrderNumber)
      .exec();

    // Check if any of these sales contain the specific BOM ID
    const hasSales = existingSales.some(sale =>
      sale.items?.some(item => item.bomId === bomId)
    );

    res.status(200).json({
      success: true,
      hasSales
    });
  } catch (error) {
    console.error("Error checking sales for product in work order:", error);
    res.status(500).json({
      success: false,
      message: "Error checking sales connection",
      error: error.message
    });
  }
});

module.exports = router;