// routes/defective.js
const express = require("express");
const router = express.Router();
const dynamoose = require("dynamoose"); // ✅ added import
const Defective = require("../models/defectiveModel");
const GlobalCounter = require("../models/globalCounter");
const Inventory = require("../models/inventory");
const RestoreDefective = require("../models/restoreDefectiveModel");

// Get all defective items
router.get("/get-defectives", async (req, res) => {
    try {
        const defectives = await Defective.scan().exec();
        res.status(200).json(defectives);
    } catch (error) {
        console.error("Error fetching defectives:", error);
        res.status(500).json({ message: "Error fetching defectives", error });
    }
});

// Helper function to update inventory for defective items
const updateInventoryForDefect = async (items, isRestore = false) => {
    for (const item of items) {
        try {
            // Find the inventory item
            const inventoryItem = await Inventory.scan("itemId").eq(item.itemId).exec();

            if (inventoryItem && inventoryItem.length > 0) {
                const existingItem = inventoryItem[0];
                const quantity = item.quantity || 0;

                if (isRestore) {
                    // For restore: remove from defect, add back to currentStock
                    await Inventory.update(
                        { inventoryId: existingItem.inventoryId },
                        {
                            $SET: {
                                defect: Math.max(0, (existingItem.defect || 0) - quantity),
                                currentStock: (existingItem.currentStock || 0) + quantity,
                                lastUpdated: new Date()
                            }
                        }
                    );
                } else {
                    // For defect: add to defect, remove from currentStock
                    await Inventory.update(
                        { inventoryId: existingItem.inventoryId },
                        {
                            $SET: {
                                defect: (existingItem.defect || 0) + quantity,
                                currentStock: Math.max(0, (existingItem.currentStock || 0) - quantity),
                                lastUpdated: new Date()
                            }
                        }
                    );
                }
            } else {
                console.warn(`Inventory item not found for itemId: ${item.itemId}`);
                // Optional: Create a new inventory entry if not found
                if (!isRestore) {
                    await Inventory.create({
                        itemId: item.itemId,
                        itemName: item.itemName,
                        hsnCode: item.hsnCode,
                        description: item.itemDescription,
                        currentStock: 0,
                        defect: item.quantity || 0,
                        lastUpdated: new Date()
                    });
                }
            }
        } catch (error) {
            console.error(`Error updating inventory for item ${item.itemId}:`, error);
            throw error;
        }
    }
};

// Create new defective record
router.post("/create-defective", async (req, res) => {
    try {
        const { type, items, date } = req.body;
        const counterId = "defective";

        // Get or create counter
        let counter = await GlobalCounter.get(counterId);
        if (!counter) {
            counter = await GlobalCounter.create({ id: counterId, count: 1 });
        } else {
            counter = await GlobalCounter.update(
                { id: counterId },
                { count: counter.count + 1 }
            );
        }

        const newDefectiveNumber = `DF2025${String(counter.count).padStart(4, "0")}`;

        // Create defective record
        const newDefective = new Defective({
            ...req.body,
            defectiveNumber: newDefectiveNumber,
        });

        await newDefective.save();

        // 👇 Update inventory based on defective type
        if (type === "defectFinds") {
            await updateInventoryForDefect(items, false); // Mark as defective
        } else if (type === "restoreDefects") {
            await updateInventoryForDefect(items, true); // Restore from defective
        }

        res.status(201).json({
            success: true,
            message: "Defective record created and inventory updated successfully",
            data: newDefective,
        });
    } catch (error) {
        console.error("Error saving defective record:", error);
        res.status(500).json({
            success: false,
            message: "Error saving defective record",
            error: error.message,
        });
    }
});

// Delete defective record (with inventory reversal)
router.delete("/delete-defective/:id", async (req, res) => {
    try {
        const { id } = req.params;

        // First get the defective record to reverse inventory changes
        const defectiveRecord = await Defective.get({ defectiveId: id });

        if (defectiveRecord) {
            // Reverse the inventory changes
            if (defectiveRecord.type === "defectFinds") {
                // If it was a defect find, restore the stock
                await updateInventoryForDefect(defectiveRecord.items, true);
            } else if (defectiveRecord.type === "restoreDefects") {
                // If it was a restore, put back to defect
                await updateInventoryForDefect(defectiveRecord.items, false);
            }
        }

        // Now delete the defective record
        await Defective.delete({ defectiveId: id });

        res.status(200).json({
            success: true,
            message: "Defective record deleted and inventory reversed successfully",
        });
    } catch (error) {
        console.error("Error deleting defective record:", error);
        res.status(500).json({
            success: false,
            message: "Error deleting defective record",
            error: error.message,
        });
    }
});

const validateRestoreQuantities = async (defectiveId, items) => {
    const validationErrors = [];

    // Get the original defective record
    const originalDefective = await Defective.get({ defectiveId });

    if (!originalDefective) {
        throw new Error("Original defective record not found");
    }

    // Check each item quantity
    for (const restoreItem of items) {
        const originalItem = originalDefective.items.find(
            item => item.itemId === restoreItem.itemId
        );

        if (!originalItem) {
            validationErrors.push({
                itemId: restoreItem.itemId,
                itemName: restoreItem.itemName,
                error: "Item not found in original defective record"
            });
            continue;
        }

        // Check if restore quantity exceeds original defective quantity
        if (restoreItem.quantity > originalItem.quantity) {
            validationErrors.push({
                itemId: restoreItem.itemId,
                itemName: restoreItem.itemName,
                error: `Cannot restore more than original defective quantity. Original: ${originalItem.quantity}, Attempted: ${restoreItem.quantity}`
            });
        }

        // Additional check: verify current defect quantity in inventory
        const inventoryItem = await Inventory.scan("itemId").eq(restoreItem.itemId).exec();
        if (inventoryItem && inventoryItem.length > 0) {
            const currentDefectQty = inventoryItem[0].defect || 0;
            if (restoreItem.quantity > currentDefectQty) {
                validationErrors.push({
                    itemId: restoreItem.itemId,
                    itemName: restoreItem.itemName,
                    error: `Cannot restore more than current defect quantity. Current defects: ${currentDefectQty}, Attempted: ${restoreItem.quantity}`
                });
            }
        }
    }

    return validationErrors;
};

// Create new restore defective record
// In your create-restore-defective route, change the counter ID:
router.post("/create-restore-defective", async (req, res) => {
    try {
        const { defectiveReferenceId, items, date, notes } = req.body;

        // Validate restore quantities
        const validationErrors = await validateRestoreQuantities(defectiveReferenceId, items);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Validation errors in restore quantities",
                errors: validationErrors
            });
        }

        // Get original defective record for reference
        const originalDefective = await Defective.get({ defectiveId: defectiveReferenceId });

        // Get or create counter for restore records - USE DIFFERENT COUNTER ID
        const counterId = "restoreDefective"; // Changed from "defective"
        let counter = await GlobalCounter.get(counterId);
        if (!counter) {
            counter = await GlobalCounter.create({ id: counterId, count: 1 });
        } else {
            counter = await GlobalCounter.update(
                { id: counterId },
                { count: counter.count + 1 }
            );
        }

        const newRestoreNumber = `RD2025${String(counter.count).padStart(4, "0")}`; // RD prefix instead of DF

        // Create restore record with original quantities for reference
        const newRestore = new RestoreDefective({
            restoreNumber: newRestoreNumber,
            date,
            defectiveReferenceId,
            defectiveReferenceNumber: originalDefective.defectiveNumber,
            items: items.map(restoreItem => {
                const originalItem = originalDefective.items.find(
                    item => item.itemId === restoreItem.itemId
                );
                return {
                    ...restoreItem,
                    originalDefectQuantity: originalItem ? originalItem.quantity : 0
                };
            }),
            notes
        });

        await newRestore.save();

        // Update inventory (reverse the defect: remove from defect, add to current stock)
        await updateInventoryForDefect(items, true); // true = restore operation

        res.status(201).json({
            success: true,
            message: "Defective items restored successfully",
            data: newRestore,
        });
    } catch (error) {
        console.error("Error saving restore defective record:", error);
        res.status(500).json({
            success: false,
            message: "Error saving restore defective record",
            error: error.message,
        });
    }
});

// Get all restore records
router.get("/get-restore-defectives", async (req, res) => {
    try {
        const restoreDefectives = await RestoreDefective.scan().exec();
        res.status(200).json(restoreDefectives);
    } catch (error) {
        console.error("Error fetching restore defectives:", error);
        res.status(500).json({ message: "Error fetching restore defectives", error });
    }
});


// Add this to your defective routes
router.post("/validate-restore", async (req, res) => {
    try {
        const { defectiveId, items } = req.body;
        const validationErrors = await validateRestoreQuantities(defectiveId, items);

        res.status(200).json({
            valid: validationErrors.length === 0,
            errors: validationErrors
        });
    } catch (error) {
        console.error("Error validating restore:", error);
        res.status(500).json({
            valid: false,
            errors: [{ error: "Validation error" }]
        });
    }
});

module.exports = router;
