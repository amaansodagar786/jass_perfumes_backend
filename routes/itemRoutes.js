const express = require("express");
const router = express.Router();
const Item = require("../models/item");
const Inventory = require("../models/inventory");

// Create Item
router.post("/create-item", async (req, res) => {
  try {
    const { itemName } = req.body;

    // Check for existing item name
    const existingItems = await Item.scan("itemName").eq(itemName).exec();

    if (existingItems.length > 0) {
      return res.status(400).json({
        message: "Item with this name already exists",
        field: "itemName"
      });
    }

    const item = new Item(req.body);
    const savedItem = await item.save();

    // Create inventory entry for item
    const inventoryItem = new Inventory({
      itemId: savedItem.itemId,
      itemName: savedItem.itemName,
      hsnCode: savedItem.hsnCode,
      unit: savedItem.unit,
      description: savedItem.description,
      minimumQty: savedItem.minimumQty,
    });

    await inventoryItem.save();
    res.status(201).json(savedItem);
  } catch (error) {
    console.error("Error saving item:", error);
    res.status(500).json({ message: "Error saving item", error });
  }
});

// Get All Items
router.get("/get-items", async (req, res) => {
  try {
    const items = await Item.scan().exec();
    res.status(200).json(items);
  } catch (error) {
    console.error("Error fetching items:", error);
    res.status(500).json({ message: "Error fetching items", error });
  }
});

// Update Item (and its Inventory)
// Update Item (and its Inventory)
router.put("/update-item/:id", async (req, res) => {
  try {
    const { itemId, _id, createdAt, updatedAt, ...updateData } = req.body;

    const cleanData = {
      ...updateData,
      minimumQty: Number(updateData.minimumQty),
      taxSlab: Number(updateData.taxSlab)
    };

    // Update Item
    const item = await Item.update({ itemId: req.params.id }, cleanData);

    // ✅ Find Inventory by itemId
    const inventories = await Inventory.scan("itemId").eq(req.params.id).exec();
    if (inventories.length > 0) {
      const inventory = inventories[0]; // There should be only one
      await Inventory.update(
        { inventoryId: inventory.inventoryId }, // use hashKey
        {
          itemName: item.itemName,
          hsnCode: item.hsnCode,
          unit: item.unit,
          description: item.description,
          minimumQty: item.minimumQty,
          lastUpdated: new Date()
        }
      );
    }

    res.status(200).json(item);
  } catch (error) {
    console.error("Error updating item:", error);
    res.status(500).json({
      message: "Failed to update item",
      error: error.message
    });
  }
});


// Delete Item (and its Inventory)
router.delete("/delete-item/:id", async (req, res) => {
  try {
    await Item.delete({ itemId: req.params.id });

    // Delete inventory for this item
    const inventories = await Inventory.scan("itemId").eq(req.params.id).exec();
    for (const inv of inventories) {
      await Inventory.delete({ inventoryId: inv.inventoryId });
    }

    res.status(200).json({ message: "Item and related inventory deleted successfully" });
  } catch (error) {
    console.error("Error deleting item:", error);
    res.status(500).json({
      message: "Failed to delete item",
      error: error.message
    });
  }
});

module.exports = router;
