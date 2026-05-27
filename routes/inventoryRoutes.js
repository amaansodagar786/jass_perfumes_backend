const express = require("express");
const router = express.Router();
const Inventory = require("../models/inventory");
const Product = require("../models/product");
const ProductDisposal = require("../models/ProductDisposal");
const InventoryCleanupService = require("../routes/inventoryCleanupService");
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });

// Get all inventory with product details

router.get("/get-inventory", async (req, res) => {
    try {
        const inventory = await Inventory.find({}).sort({ createdAt: -1 });

        // Enrich with product details and disposal info
        const enrichedInventory = await Promise.all(
            inventory.map(async (item) => {
                const product = await Product.findOne({ productId: item.productId });

                // Get ALL disposal records for this product
                const disposalRecords = await ProductDisposal.find({
                    productId: item.productId
                });

                // Create a map of batch disposals - aggregate all disposals for each batch
                const batchDisposals = {};
                let totalProductDisposed = 0;

                disposalRecords.forEach(record => {
                    record.batches.forEach(disposalBatch => {
                        if (!batchDisposals[disposalBatch.batchNumber]) {
                            batchDisposals[disposalBatch.batchNumber] = [];
                        }
                        batchDisposals[disposalBatch.batchNumber].push({
                            type: record.type,
                            quantity: disposalBatch.quantity,
                            reason: record.reason,
                            disposalDate: record.disposalDate,
                            disposalId: record.disposalId
                        });

                        totalProductDisposed += disposalBatch.quantity;
                    });
                });

                // Enrich batches with disposal info INCLUDING PRICE
                const enrichedBatches = item.batches.map(batch => {
                    const disposals = batchDisposals[batch.batchNumber] || [];
                    const totalDisposedFromBatch = disposals.reduce((sum, d) => sum + d.quantity, 0);

                    return {
                        ...batch.toObject(),
                        disposals: disposals,
                        totalDisposed: totalDisposedFromBatch,
                        currentQuantity: batch.quantity,
                        originalQuantity: batch.quantity + totalDisposedFromBatch,
                        price: batch.price // INCLUDE PRICE IN RESPONSE
                    };
                });

                return {
                    inventoryId: item.inventoryId,
                    productId: item.productId,
                    productName: item.productName,
                    category: item.category,
                    hsnCode: product?.hsnCode || "-",
                    price: product?.price || 0,
                    taxSlab: product?.taxSlab || 0,
                    discount: product?.discount || 0,
                    totalQuantity: item.totalQuantity,
                    batches: enrichedBatches,
                    priceHistory: item.priceHistory || [],
                    totalDisposed: totalProductDisposed,
                    status: item.totalQuantity === 0 ? "Out of Stock" :
                        item.totalQuantity <= 10 ? "Low Stock" : "In Stock",
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt
                };
            })
        );

        res.status(200).json({
            success: true,
            data: enrichedInventory
        });
    } catch (error) {
        console.error("Error fetching inventory:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch inventory data",
            error: error.message
        });
    }
});


// ✅ ADD / UPDATE BATCHES
router.post("/add-batches", async (req, res) => {
    try {
        console.log("🔍 ADD-BATCHES REQUEST BODY:", req.body);

        const { productId, batches, price, userDetails } = req.body;

        if (!productId || !Array.isArray(batches) || !price) {
            console.log("❌ VALIDATION FAILED - Missing required fields");
            return res.status(400).json({
                success: false,
                message: "Product ID, batches array, and price are required"
            });
        }

        console.log('👤 ADD BATCHES REQUEST BY:', {
            user: userDetails ? `${userDetails.name} (${userDetails.email})` : 'Unknown User',
            productId: productId,
            batchesCount: batches.length,
            price: price,
            timestamp: new Date().toISOString()
        });

        const product = await Product.findOne({ productId });
        if (!product) {
            console.log("❌ PRODUCT NOT FOUND:", productId);
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        console.log("✅ PRODUCT FOUND:", product.productName);

        let inventoryItem = await Inventory.findOne({ productId });
        console.log("📦 INVENTORY ITEM:", inventoryItem ? "Found" : "Creating new");

        if (!inventoryItem) {
            inventoryItem = new Inventory({
                productId: product.productId,
                productName: product.productName,
                category: product.category,
                priceHistory: [],
                batches: []
            });
        }

        let addedBatches = 0;
        let updatedBatches = 0;
        const errors = [];
        const newBatchNumbers = [];
        const batchDetails = [];

        console.log("🔄 PROCESSING BATCHES:", batches);

        for (const batch of batches) {
            try {
                console.log("   Processing batch:", batch.batchNumber);

                if (!batch.batchNumber || !batch.quantity || !batch.manufactureDate) {
                    errors.push({
                        batchNumber: batch.batchNumber || 'N/A',
                        message: "Missing required fields",
                        details: "Batch Number, Quantity, and Manufacture Date are required"
                    });
                    continue;
                }

                const manufactureDate = new Date(batch.manufactureDate + '-01');
                if (isNaN(manufactureDate.getTime())) {
                    errors.push({
                        batchNumber: batch.batchNumber,
                        message: "Invalid manufacture date format",
                        details: `Expected YYYY-MM format, got: ${batch.manufactureDate}`
                    });
                    continue;
                }

                const expiryDate = new Date(manufactureDate);
                expiryDate.setMonth(expiryDate.getMonth() + 60);

                console.log("   Manufacture Date:", manufactureDate);
                console.log("   Expiry Date:", expiryDate);

                const existingBatchIndex = inventoryItem.batches.findIndex(
                    b => b.batchNumber === batch.batchNumber
                );

                if (existingBatchIndex !== -1) {
                    const newManufacture = manufactureDate.toISOString().substring(0, 7);
                    const existingManufacture = new Date(inventoryItem.batches[existingBatchIndex].manufactureDate)
                        .toISOString().substring(0, 7);

                    console.log("   New Manufacture:", newManufacture, "Existing:", existingManufacture);

                    if (newManufacture !== existingManufacture) {
                        console.log("   ❌ DIFFERENT MANUFACTURE DATE");
                        errors.push({
                            batchNumber: batch.batchNumber,
                            message: "Batch already exists with different manufacture date",
                            details: `Existing manufacture date: ${existingManufacture}, New manufacture date: ${newManufacture}`
                        });
                        continue;
                    } else {
                        console.log("   ✅ SAME DATE - UPDATING QUANTITY");
                        const oldQuantity = inventoryItem.batches[existingBatchIndex].quantity;
                        const addedQty = parseInt(batch.quantity);
                        inventoryItem.batches[existingBatchIndex].quantity += addedQty;
                        updatedBatches++;

                        // ✅ ADD NEW PRICE HISTORY ENTRY FOR UPDATED BATCH
                        inventoryItem.priceHistory.push({
                            price: parseFloat(price),
                            quantityAdded: addedQty,
                            batchNumbers: [batch.batchNumber],
                            addedAt: new Date()
                        });

                        batchDetails.push({
                            batchNumber: batch.batchNumber,
                            action: 'UPDATED',
                            oldQuantity: oldQuantity,
                            newQuantity: inventoryItem.batches[existingBatchIndex].quantity,
                            quantityAdded: addedQty,
                            manufactureDate: newManufacture
                        });

                        console.log(`✅ Updated existing batch ${batch.batchNumber} - Added ${addedQty} units`);
                    }
                } else {
                    console.log("   ✅ NEW BATCH - ADDING");
                    const newBatch = {
                        batchNumber: batch.batchNumber,
                        quantity: parseInt(batch.quantity),
                        manufactureDate: manufactureDate,
                        expiryDate: expiryDate,
                        addedAt: new Date()
                    };

                    inventoryItem.batches.push(newBatch);
                    newBatchNumbers.push(batch.batchNumber);
                    addedBatches++;

                    // ✅ ADD PRICE HISTORY FOR NEW BATCH
                    inventoryItem.priceHistory.push({
                        price: parseFloat(price),
                        quantityAdded: parseInt(batch.quantity),
                        batchNumbers: [batch.batchNumber],
                        addedAt: new Date()
                    });

                    batchDetails.push({
                        batchNumber: batch.batchNumber,
                        action: 'ADDED',
                        quantity: parseInt(batch.quantity),
                        manufactureDate: manufactureDate.toISOString().substring(0, 7),
                        expiryDate: expiryDate.toISOString().substring(0, 7)
                    });

                    console.log(`✅ Added new batch ${batch.batchNumber} with ${batch.quantity} units`);
                }
            } catch (batchError) {
                console.error(`Error processing batch ${batch.batchNumber}:`, batchError);
                errors.push({
                    batchNumber: batch.batchNumber || 'N/A',
                    message: "Batch processing error",
                    details: batchError.message
                });
            }
        }

        console.log("📊 BATCH PROCESSING RESULTS:");
        console.log("   Added:", addedBatches, "Updated:", updatedBatches, "Errors:", errors.length);

        await inventoryItem.save();
        console.log("💾 INVENTORY SAVED SUCCESSFULLY");

        console.log('📝 BATCHES ADDED/UPDATE SUCCESS:', {
            productId: productId,
            productName: product.productName,
            user: userDetails ? `${userDetails.name} (${userDetails.email})` : 'Unknown User',
            addedBatches: addedBatches,
            updatedBatches: updatedBatches,
            totalBatchesProcessed: addedBatches + updatedBatches,
            totalQuantityAdded: batchDetails.reduce((sum, batch) => sum + (batch.quantityAdded || batch.quantity || 0), 0),
            pricePerUnit: price,
            batchDetails: batchDetails,
            errorsCount: errors.length,
            timestamp: new Date().toISOString()
        });

        let successMessage = "";
        if (addedBatches > 0 && updatedBatches > 0) {
            successMessage = `Batches processed successfully. Added: ${addedBatches}, Updated: ${updatedBatches}`;
        } else if (addedBatches > 0) {
            successMessage = `Batches added successfully. Added: ${addedBatches}`;
        } else if (updatedBatches > 0) {
            successMessage = `Batches updated successfully. Updated: ${updatedBatches}`;
        }

        console.log("🎯 SENDING SUCCESS RESPONSE:", successMessage);

        res.status(200).json({
            success: true,
            message: successMessage,
            addedBatches,
            updatedBatches,
            price: price,
            errors: errors.length > 0 ? errors : undefined,
            data: inventoryItem
        });

    } catch (error) {
        console.error("💥 ERROR IN ADD-BATCHES:", error);
        res.status(500).json({
            success: false,
            message: "Failed to add batches",
            error: error.message
        });
    }
});


// ✅ BULK UPLOAD UPDATED
router.post("/bulk-upload", upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }

        console.log("Processing uploaded file:", req.file.path);

        let userDetails = null;
        if (req.body.userDetails) {
            try {
                userDetails = JSON.parse(req.body.userDetails);
            } catch (parseError) {
                console.error("Error parsing userDetails:", parseError);
            }
        }

        console.log('👤 BULK UPLOAD STARTED:', {
            user: userDetails ? `${userDetails.name} (${userDetails.email})` : 'Unknown User',
            fileName: req.file.originalname,
            timestamp: new Date().toISOString()
        });

        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        let addedBatches = 0;
        let updatedBatches = 0;
        const errors = [];

        const allProducts = await Product.find({});
        const productPriceHistory = {};

        for (const [index, row] of data.entries()) {
            try {
                const productName = row['Product Name'];
                const batchNumber = row['Batch Number'];
                const quantity = row['Quantity'];
                const manufactureDateInput = row['Manufacture Date'];
                const price = row['Price'];

                if (!productName || !batchNumber || !quantity || !manufactureDateInput || !price) continue;

                const product = allProducts.find(p =>
                    p.productName.trim().toLowerCase() === productName.trim().toLowerCase()
                );
                if (!product) continue;

                let inventoryItem = await Inventory.findOne({ productId: product.productId });
                if (!inventoryItem) {
                    inventoryItem = new Inventory({
                        productId: product.productId,
                        productName: product.productName,
                        category: product.category,
                        priceHistory: [],
                        batches: []
                    });
                }

                let manufactureDate;
                if (typeof manufactureDateInput === "string" && manufactureDateInput.match(/^\d{4}-\d{2}$/)) {
                    manufactureDate = new Date(manufactureDateInput + '-01');
                } else {
                    manufactureDate = new Date(manufactureDateInput);
                }

                const expiryDate = new Date(manufactureDate);
                expiryDate.setMonth(expiryDate.getMonth() + 60);

                const existingBatchIndex = inventoryItem.batches.findIndex(
                    b => b.batchNumber === batchNumber.trim()
                );

                if (existingBatchIndex !== -1) {
                    const existingBatch = inventoryItem.batches[existingBatchIndex];
                    const newManufactureMonth = manufactureDate.toISOString().substring(0, 7);
                    const existingManufactureMonth = new Date(existingBatch.manufactureDate).toISOString().substring(0, 7);

                    if (newManufactureMonth === existingManufactureMonth) {
                        const addedQty = parseInt(quantity);
                        inventoryItem.batches[existingBatchIndex].quantity += addedQty;
                        updatedBatches++;

                        // ✅ ADD NEW PRICE HISTORY ENTRY FOR UPDATED BATCH
                        inventoryItem.priceHistory.push({
                            price: parseFloat(price),
                            quantityAdded: addedQty,
                            batchNumbers: [batchNumber.trim()],
                            addedAt: new Date()
                        });
                    }
                } else {
                    inventoryItem.batches.push({
                        batchNumber: batchNumber.trim(),
                        quantity: parseInt(quantity),
                        manufactureDate: manufactureDate,
                        expiryDate: expiryDate,
                        addedAt: new Date()
                    });

                    addedBatches++;

                    // ✅ ADD PRICE HISTORY ENTRY FOR NEW BATCH
                    inventoryItem.priceHistory.push({
                        price: parseFloat(price),
                        quantityAdded: parseInt(quantity),
                        batchNumbers: [batchNumber.trim()],
                        addedAt: new Date()
                    });
                }

                await inventoryItem.save();
            } catch (err) {
                console.error(`Error row ${index + 2}:`, err.message);
            }
        }

        fs.unlinkSync(req.file.path);

        console.log(`Bulk upload completed. Added: ${addedBatches}, Updated: ${updatedBatches}`);

        res.status(200).json({
            success: true,
            message: `Bulk upload completed. Added: ${addedBatches}, Updated: ${updatedBatches}`,
            addedBatches,
            updatedBatches,
            totalErrors: errors.length
        });

    } catch (error) {
        console.error("Error in bulk upload:", error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({
            success: false,
            message: "Failed to process bulk upload",
            error: error.message
        });
    }
});






router.post("/dispose-product", async (req, res) => {
    try {
        const { productId, type, batchNumber, quantity, reason, batches, disposalDate } = req.body;

        if (!productId || !type) {
            return res.status(400).json({
                success: false,
                message: "Product ID and disposal type are required"
            });
        }

        // Find the product and inventory
        const product = await Product.findOne({ productId });
        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        const inventoryItem = await Inventory.findOne({ productId });
        if (!inventoryItem) {
            return res.status(404).json({
                success: false,
                message: "Inventory item not found"
            });
        }

        let totalQuantityDisposed = 0;
        const disposedBatches = [];

        if (type === "defective") {
            // Handle defective disposal
            if (!batchNumber || !quantity || !reason) {
                return res.status(400).json({
                    success: false,
                    message: "Batch number, quantity, and reason are required for defective disposal"
                });
            }

            // Find the batch
            const batchIndex = inventoryItem.batches.findIndex(b => b.batchNumber === batchNumber);
            if (batchIndex === -1) {
                return res.status(404).json({
                    success: false,
                    message: "Batch not found"
                });
            }

            const batch = inventoryItem.batches[batchIndex];
            if (batch.quantity < quantity) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient quantity in batch. Available: ${batch.quantity}`
                });
            }

            // Update batch quantity
            inventoryItem.batches[batchIndex].quantity -= parseInt(quantity);
            totalQuantityDisposed = parseInt(quantity);

            disposedBatches.push({
                batchNumber: batch.batchNumber,
                quantity: parseInt(quantity),
                manufactureDate: batch.manufactureDate,
                expiryDate: batch.expiryDate
            });

        } else if (type === "expired") {
            // Handle expired disposal
            if (!batches || !Array.isArray(batches) || batches.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "Batches array is required for expired disposal"
                });
            }

            for (const disposalBatch of batches) {
                const batchIndex = inventoryItem.batches.findIndex(b => b.batchNumber === disposalBatch.batchNumber);
                if (batchIndex !== -1) {
                    const batch = inventoryItem.batches[batchIndex];
                    const quantityToRemove = disposalBatch.quantity;

                    if (batch.quantity >= quantityToRemove) {
                        inventoryItem.batches[batchIndex].quantity -= quantityToRemove;
                        totalQuantityDisposed += quantityToRemove;

                        disposedBatches.push({
                            batchNumber: batch.batchNumber,
                            quantity: quantityToRemove,
                            manufactureDate: batch.manufactureDate,
                            expiryDate: batch.expiryDate
                        });
                    }
                }
            }

            if (totalQuantityDisposed === 0) {
                return res.status(400).json({
                    success: false,
                    message: "No batches were disposed"
                });
            }
        }

        // Remove batches with zero quantity
        inventoryItem.batches = inventoryItem.batches.filter(batch => batch.quantity > 0);

        // Save updated inventory
        await inventoryItem.save();

        // Create disposal record
        const disposalRecord = new ProductDisposal({
            productId: product.productId,
            productName: product.productName,
            category: product.category,
            type: type,
            batches: disposedBatches,
            reason: type === 'defective' ? reason : 'Expired',
            totalQuantityDisposed: totalQuantityDisposed,
            disposalDate: disposalDate || new Date()
        });

        await disposalRecord.save();

        res.status(200).json({
            success: true,
            message: `Products disposed successfully. Total quantity: ${totalQuantityDisposed}`,
            data: {
                disposalRecord,
                updatedInventory: inventoryItem
            }
        });

    } catch (error) {
        console.error("Error disposing products:", error);
        res.status(500).json({
            success: false,
            message: "Failed to dispose products",
            error: error.message
        });
    }
});

// Get disposal history
// Get disposal history
router.get("/disposal-history", async (req, res) => {
    try {
        const { productId, type, startDate, endDate, page = 1, limit = 50 } = req.query;

        let query = {};
        if (productId) query.productId = productId;
        if (type) query.type = type;

        // Fix date filtering
        if (startDate || endDate) {
            query.disposalDate = {};
            if (startDate) {
                query.disposalDate.$gte = new Date(startDate);
            }
            if (endDate) {
                query.disposalDate.$lte = new Date(endDate);
            }
        }

        const disposals = await ProductDisposal.find(query)
            .sort({ disposalDate: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await ProductDisposal.countDocuments(query);

        res.status(200).json({
            success: true,
            data: disposals,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });

    } catch (error) {
        console.error("Error fetching disposal history:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch disposal history",
            error: error.message
        });
    }
});


// Run automated cleanup
router.post("/run-cleanup", async (req, res) => {
    try {
        const results = await InventoryCleanupService.performCleanup();

        res.status(200).json({
            success: true,
            message: `Cleanup completed successfully`,
            data: results
        });

    } catch (error) {
        console.error("Cleanup error:", error);
        res.status(500).json({
            success: false,
            message: "Cleanup failed",
            error: error.message
        });
    }
});

// Get cleanup statistics
router.get("/cleanup-stats", async (req, res) => {
    try {
        const stats = await InventoryCleanupService.getCleanupStats();

        res.status(200).json({
            success: true,
            data: stats
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to get cleanup stats",
            error: error.message
        });
    }
});



module.exports = router;