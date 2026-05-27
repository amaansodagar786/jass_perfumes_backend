const express = require("express");
const router = express.Router();
const Invoice = require("../models/invoiceModel");
const Inventory = require("../models/inventory");
const Product = require("../models/product");
const ProductDisposal = require("../models/ProductDisposal");

// Helper function to calculate date range
// Helper function to calculate date range - FIXED VERSION
const getDateRange = (filter, customStart, customEnd) => {
    const now = new Date();
    let startDate, endDate;

    switch (filter) {
        case 'today':
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
            break;
        case 'week':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            break;
        case 'year':
            startDate = new Date(now.getFullYear(), 0, 1);
            endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
            break;
        case 'custom':
            startDate = new Date(customStart);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(customEnd);
            endDate.setHours(23, 59, 59, 999);
            break;
        default:
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
    }

    console.log('Date Range:', { filter, startDate, endDate }); // Debug log

    return { startDate, endDate };
};

// Sales Summary Report
router.get("/sales-summary", async (req, res) => {
    try {
        const { filter = 'today', startDate, endDate } = req.query;
        const dateRange = getDateRange(filter, startDate, endDate);

        const invoices = await Invoice.find({
            createdAt: {
                $gte: dateRange.startDate,
                $lte: dateRange.endDate
            }
        });

        // Calculate summary data
        const totalSales = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
        const totalItemsSold = invoices.reduce((sum, invoice) =>
            sum + invoice.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
        );
        const totalTax = invoices.reduce((sum, invoice) => sum + invoice.tax, 0);
        const totalDiscount = invoices.reduce((sum, invoice) =>
            sum +
            (invoice.discount || 0) +         // Existing normal discount
            (invoice.promoDiscount || 0) +    // ✅ New promo discount
            (invoice.loyaltyDiscount || 0),   // ✅ New loyalty discount
            0);
        const invoiceCount = invoices.length;
        const averageOrderValue = invoiceCount > 0 ? totalSales / invoiceCount : 0;

        // Payment method distribution
        const paymentMethods = invoices.reduce((acc, invoice) => {
            acc[invoice.paymentType] = (acc[invoice.paymentType] || 0) + 1;
            return acc;
        }, {});

        // Top selling products
        const productSales = {};
        invoices.forEach(invoice => {
            invoice.items.forEach(item => {
                if (!productSales[item.productId]) {
                    productSales[item.productId] = {
                        productId: item.productId,
                        name: item.name,
                        category: item.category,
                        totalQuantity: 0,
                        totalRevenue: 0
                    };
                }
                productSales[item.productId].totalQuantity += item.quantity;
                productSales[item.productId].totalRevenue += item.totalAmount;
            });
        });

        const topProducts = Object.values(productSales)
            .sort((a, b) => b.totalQuantity - a.totalQuantity)
            .slice(0, 10);

        // Sales trend data (last 7 days for chart)
        const trendData = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);

            const dayEnd = new Date(date);
            dayEnd.setHours(23, 59, 59, 999);

            const dayInvoices = invoices.filter(inv =>
                new Date(inv.createdAt) >= date && new Date(inv.createdAt) <= dayEnd
            );

            const daySales = dayInvoices.reduce((sum, inv) => sum + inv.total, 0);
            const dayItems = dayInvoices.reduce((sum, inv) =>
                sum + inv.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
            );

            trendData.push({
                date: date.toISOString().split('T')[0],
                sales: daySales,
                orders: dayInvoices.length,
                items: dayItems
            });
        }

        res.status(200).json({
            success: true,
            data: {
                summary: {
                    totalSales,
                    totalItemsSold,
                    totalTax,
                    totalDiscount,
                    invoiceCount,
                    averageOrderValue
                },
                paymentMethods: Object.entries(paymentMethods).map(([method, count]) => ({
                    method,
                    count,
                    percentage: invoiceCount > 0 ? (count / invoiceCount * 100).toFixed(1) : "0"
                })),
                topProducts,
                trendData
            }
        });

    } catch (error) {
        console.error("Error generating sales report:", error);
        res.status(500).json({
            success: false,
            message: "Failed to generate sales report",
            error: error.message
        });
    }
});

// Purchase Summary Report - FIXED CALCULATIONS
router.get("/purchase-summary", async (req, res) => {
    try {
        const { filter = 'today', startDate, endDate } = req.query;
        const dateRange = getDateRange(filter, startDate, endDate);

        const inventoryItems = await Inventory.find({
            "priceHistory.addedAt": {
                $gte: dateRange.startDate,
                $lte: dateRange.endDate
            }
        });

        // Calculate purchase data from price history
        let totalPurchaseValue = 0;
        let totalQuantityPurchased = 0;
        let purchaseTransactionCount = 0; // This counts actual purchase transactions
        const categoryBreakdown = {};
        const recentPurchases = [];

        inventoryItems.forEach(item => {
            item.priceHistory.forEach(history => {
                const historyDate = new Date(history.addedAt);
                if (historyDate >= dateRange.startDate && historyDate <= dateRange.endDate) {
                    const purchaseValue = history.price * history.quantityAdded;
                    totalPurchaseValue += purchaseValue;
                    totalQuantityPurchased += history.quantityAdded;
                    purchaseTransactionCount++; // Each price history entry is a purchase transaction

                    // Category breakdown
                    if (!categoryBreakdown[item.category]) {
                        categoryBreakdown[item.category] = {
                            category: item.category,
                            totalValue: 0,
                            totalQuantity: 0,
                            transactionCount: 0
                        };
                    }
                    categoryBreakdown[item.category].totalValue += purchaseValue;
                    categoryBreakdown[item.category].totalQuantity += history.quantityAdded;
                    categoryBreakdown[item.category].transactionCount++;

                    // Recent purchases
                    recentPurchases.push({
                        productName: item.productName,
                        category: item.category,
                        batchNumbers: history.batchNumbers,
                        quantity: history.quantityAdded,
                        price: history.price,
                        totalValue: purchaseValue,
                        date: history.addedAt,
                        transactionId: `PUR-${history.addedAt.getTime()}`
                    });
                }
            });
        });

        // Sort recent purchases by date
        recentPurchases.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Purchase trend data
        const trendData = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);

            const dayEnd = new Date(date);
            dayEnd.setHours(23, 59, 59, 999);

            let dayPurchaseValue = 0;
            let dayQuantity = 0;
            let dayTransactions = 0;

            inventoryItems.forEach(item => {
                item.priceHistory.forEach(history => {
                    const historyDate = new Date(history.addedAt);
                    if (historyDate >= date && historyDate <= dayEnd) {
                        dayPurchaseValue += history.price * history.quantityAdded;
                        dayQuantity += history.quantityAdded;
                        dayTransactions++;
                    }
                });
            });

            trendData.push({
                date: date.toISOString().split('T')[0],
                purchaseValue: dayPurchaseValue,
                quantity: dayQuantity,
                transactions: dayTransactions
            });
        }

        const averagePurchasePrice = totalQuantityPurchased > 0 ?
            totalPurchaseValue / totalQuantityPurchased : 0;

        res.status(200).json({
            success: true,
            data: {
                summary: {
                    totalPurchaseValue,
                    totalQuantityPurchased,
                    averagePurchasePrice,
                    purchaseCount: purchaseTransactionCount, // Now shows actual purchase transactions
                    uniqueProducts: inventoryItems.length
                },
                categoryBreakdown: Object.values(categoryBreakdown)
                    .sort((a, b) => b.totalValue - a.totalValue),
                recentPurchases: recentPurchases.slice(0, 10),
                trendData
            }
        });

    } catch (error) {
        console.error("Error generating purchase report:", error);
        res.status(500).json({
            success: false,
            message: "Failed to generate purchase report",
            error: error.message
        });
    }
});


// Fixed Inventory-Expiry Backend Route
router.get("/inventory-expiry", async (req, res) => {
    try {
        const {
            status,
            category,
            showBatches,
            expiryFilter = 'all',
            startDate,
            endDate,
            includeDisposed = 'false'
        } = req.query;

        console.log("Received filters:", {
            status, category, showBatches, expiryFilter, startDate, endDate, includeDisposed
        });

        // Build base query for inventory items
        let inventoryQuery = {};

        // Filter by category if specified
        if (category && category !== 'all') {
            inventoryQuery.category = category;
        }

        // Get all inventory with product details
        const inventoryItems = await Inventory.find(inventoryQuery).sort({ createdAt: -1 });

        // Get all disposal records for expired products
        const disposalRecords = await ProductDisposal.find({
            type: 'expired'
        });

        // Create a map of disposed products for easy lookup
        const disposedProductsMap = {};
        disposalRecords.forEach(record => {
            if (!disposedProductsMap[record.productId]) {
                disposedProductsMap[record.productId] = [];
            }
            disposedProductsMap[record.productId].push(record);
        });

        // Enrich with product details
        const enrichedInventory = await Promise.all(
            inventoryItems.map(async (item) => {
                const product = await Product.findOne({ productId: item.productId });

                // Calculate status based on quantity
                let stockStatus = "In Stock";
                if (item.totalQuantity === 0) {
                    stockStatus = "Out of Stock";
                } else if (item.totalQuantity <= 10) {
                    stockStatus = "Low Stock";
                }

                // Calculate expiry status for batches
                const now = new Date();
                const thirtyDaysFromNow = new Date(now);
                thirtyDaysFromNow.setDate(now.getDate() + 30);

                const batchesWithExpiry = item.batches.map(batch => {
                    const expiryDate = new Date(batch.expiryDate);
                    const isExpired = expiryDate < now;
                    const isNearExpiry = expiryDate <= thirtyDaysFromNow && expiryDate >= now;
                    const daysToExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

                    return {
                        ...batch.toObject(),
                        isExpired,
                        isNearExpiry,
                        daysToExpiry: isExpired ? 0 : Math.max(0, daysToExpiry),
                        expiryStatus: isExpired ? 'expired' : (isNearExpiry ? 'near-expiry' : 'good')
                    };
                });

                // Get disposal records for this product - FIXED THIS PART
                const productDisposals = disposedProductsMap[item.productId] || [];

                // Create disposed batches info - FIXED STRUCTURE
                const disposedBatches = productDisposals.flatMap(record =>
                    record.batches.map(batch => ({
                        batchNumber: batch.batchNumber,
                        quantity: batch.quantity, // This was missing!
                        manufactureDate: batch.manufactureDate,
                        expiryDate: batch.expiryDate,
                        disposalDate: record.disposalDate,
                        disposalId: record.disposalId,
                        disposalReason: record.reason || 'Expired',
                        isDisposed: true
                    }))
                );

                // Calculate disposal statistics - FIXED CALCULATION
                const totalDisposedQuantity = disposedBatches.reduce((sum, batch) => sum + (batch.quantity || 0), 0);

                return {
                    inventoryId: item.inventoryId,
                    productId: item.productId,
                    productName: item.productName,
                    category: item.category,
                    hsnCode: product?.hsnCode || "-",
                    price: product?.price || 0,
                    taxSlab: product?.taxSlab || 0,
                    totalQuantity: item.totalQuantity,
                    batches: batchesWithExpiry,
                    allBatches: batchesWithExpiry,
                    disposedBatches: disposedBatches, // Now this has proper quantity field
                    priceHistory: item.priceHistory || [],
                    status: stockStatus,
                    expiryStats: {
                        totalBatches: batchesWithExpiry.length,
                        expiredBatches: batchesWithExpiry.filter(b => b.isExpired && b.quantity > 0).length,
                        nearExpiryBatches: batchesWithExpiry.filter(b => b.isNearExpiry && b.quantity > 0).length,
                        totalExpiredQuantity: batchesWithExpiry.filter(b => b.isExpired).reduce((sum, b) => sum + b.quantity, 0),
                        totalNearExpiryQuantity: batchesWithExpiry.filter(b => b.isNearExpiry).reduce((sum, b) => sum + b.quantity, 0),
                        totalDisposedExpired: totalDisposedQuantity, // Use calculated quantity
                        disposedBatchesCount: disposedBatches.length,
                        disposedQuantity: totalDisposedQuantity // Use calculated quantity
                    },
                    hasDisposedProducts: productDisposals.length > 0,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt
                };
            })
        );

        // Apply frontend filters (keep your existing filter logic)
        let filteredData = enrichedInventory.filter(item => {
            // Status filter
            if (status && status !== 'all' && item.status !== status) {
                return false;
            }

            // Expiry filter
            if (expiryFilter !== 'all') {
                if (expiryFilter === 'expired' && item.expiryStats.expiredBatches === 0) {
                    return false;
                }
                if (expiryFilter === 'near-expiry' && item.expiryStats.nearExpiryBatches === 0) {
                    return false;
                }
                if (expiryFilter === 'good' &&
                    (item.expiryStats.expiredBatches > 0 || item.expiryStats.nearExpiryBatches > 0)) {
                    return false;
                }
            }

            // Date range filter
            if (startDate && endDate) {
                const start = new Date(startDate);
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                const itemDate = new Date(item.createdAt);
                if (itemDate < start || itemDate > end) {
                    return false;
                }
            }

            return true;
        });

        // Handle batch display
        if (showBatches === 'true') {
            filteredData = filteredData.map(item => ({
                ...item,
                batches: item.batches.filter(batch => {
                    if (expiryFilter === 'expired') return batch.isExpired;
                    if (expiryFilter === 'near-expiry') return batch.isNearExpiry;
                    if (expiryFilter === 'good') return !batch.isExpired && !batch.isNearExpiry;
                    return true;
                })
            }));
        } else {
            filteredData = filteredData.map(item => ({
                ...item,
                batches: []
            }));
        }

        // Get unique categories for filter dropdown
        const categories = [...new Set(enrichedInventory.map(item => item.category))];

        // Calculate summary statistics
        const summary = {
            totalProducts: filteredData.length,
            totalQuantity: filteredData.reduce((sum, item) => sum + item.totalQuantity, 0),
            totalValue: filteredData.reduce((sum, item) => sum + (item.totalQuantity * item.price), 0),
            outOfStock: filteredData.filter(item => item.status === "Out of Stock").length,
            lowStock: filteredData.filter(item => item.status === "Low Stock").length,
            inStock: filteredData.filter(item => item.status === "In Stock").length,
            totalExpiredBatches: filteredData.reduce((sum, item) => sum + item.expiryStats.expiredBatches, 0),
            totalNearExpiryBatches: filteredData.reduce((sum, item) => sum + item.expiryStats.nearExpiryBatches, 0),
            totalExpiredQuantity: filteredData.reduce((sum, item) => sum + item.expiryStats.totalExpiredQuantity, 0),
            totalNearExpiryQuantity: filteredData.reduce((sum, item) => sum + item.expiryStats.totalNearExpiryQuantity, 0),
            totalDisposedExpired: filteredData.reduce((sum, item) => sum + item.expiryStats.totalDisposedExpired, 0)
        };

        res.status(200).json({
            success: true,
            data: {
                inventory: filteredData,
                summary,
                filters: {
                    categories,
                    statuses: ["In Stock", "Low Stock", "Out of Stock"]
                }
            }
        });

    } catch (error) {
        console.error("Error generating inventory report:", error);
        res.status(500).json({
            success: false,
            message: "Failed to generate inventory report",
            error: error.message
        });
    }
});


// Category Analysis Report


// router.get("/category-analysis", async (req, res) => {
//     try {
//         const {
//             category = 'all',
//             filter = 'month',
//             startDate,
//             endDate
//         } = req.query;

//         const dateRange = getDateRange(filter, startDate, endDate);

//         // Get all categories from products
//         const allCategories = await Inventory.distinct('category');

//         // Get sales data from invoices
//         const invoices = await Invoice.find({
//             createdAt: {
//                 $gte: dateRange.startDate,
//                 $lte: dateRange.endDate
//             }
//         });

//         // Get purchase data from inventory price history
//         const inventoryItems = await Inventory.find({
//             "priceHistory.addedAt": {
//                 $gte: dateRange.startDate,
//                 $lte: dateRange.endDate
//             }
//         });

//         // Get current stock data
//         const currentInventory = await Inventory.find({});

//         // Calculate category-wise data
//         const categoryData = {};

//         // Initialize all categories
//         allCategories.forEach(cat => {
//             categoryData[cat] = {
//                 category: cat,
//                 sales: {
//                     totalSales: 0,
//                     totalQuantity: 0,
//                     totalOrders: 0,
//                     totalTax: 0,
//                     totalDiscount: 0,
//                     averageOrderValue: 0
//                 },
//                 purchases: {
//                     totalPurchaseValue: 0,
//                     totalQuantity: 0,
//                     totalTransactions: 0,
//                     averagePurchasePrice: 0
//                 },
//                 stock: {
//                     totalQuantity: 0,
//                     totalValue: 0,
//                     totalProducts: 0,
//                     lowStockProducts: 0,
//                     outOfStockProducts: 0
//                 },
//                 products: []
//             };
//         });

//         // Process Sales Data
//         invoices.forEach(invoice => {
//             invoice.items.forEach(item => {
//                 if (categoryData[item.category]) {
//                     categoryData[item.category].sales.totalSales += item.totalAmount;
//                     categoryData[item.category].sales.totalQuantity += item.quantity;
//                     categoryData[item.category].sales.totalTax += item.taxAmount;
//                     categoryData[item.category].sales.totalDiscount += item.discountAmount;

//                     // Add product to category products list if not exists
//                     if (!categoryData[item.category].products.includes(item.productId)) {
//                         categoryData[item.category].products.push(item.productId);
//                     }
//                 }
//             });

//             // Count orders per category
//             const categoriesInInvoice = [...new Set(invoice.items.map(item => item.category))];
//             categoriesInInvoice.forEach(cat => {
//                 if (categoryData[cat]) {
//                     categoryData[cat].sales.totalOrders += 1;
//                 }
//             });
//         });

//         // Process Purchase Data
//         inventoryItems.forEach(item => {
//             item.priceHistory.forEach(history => {
//                 const historyDate = new Date(history.addedAt);
//                 if (historyDate >= dateRange.startDate && historyDate <= dateRange.endDate) {
//                     if (categoryData[item.category]) {
//                         const purchaseValue = history.price * history.quantityAdded;
//                         categoryData[item.category].purchases.totalPurchaseValue += purchaseValue;
//                         categoryData[item.category].purchases.totalQuantity += history.quantityAdded;
//                         categoryData[item.category].purchases.totalTransactions += 1;
//                     }
//                 }
//             });
//         });

//         // Process Current Stock Data
//         currentInventory.forEach(item => {
//             if (categoryData[item.category]) {
//                 categoryData[item.category].stock.totalQuantity += item.totalQuantity;
//                 categoryData[item.category].stock.totalValue += (item.totalQuantity * (item.priceHistory[0]?.price || 0));
//                 categoryData[item.category].stock.totalProducts += 1;

//                 if (item.totalQuantity === 0) {
//                     categoryData[item.category].stock.outOfStockProducts += 1;
//                 } else if (item.totalQuantity <= 10) {
//                     categoryData[item.category].stock.lowStockProducts += 1;
//                 }
//             }
//         });

//         // Calculate averages and finalize data
//         Object.keys(categoryData).forEach(cat => {
//             const data = categoryData[cat];

//             // Sales averages
//             if (data.sales.totalOrders > 0) {
//                 data.sales.averageOrderValue = data.sales.totalSales / data.sales.totalOrders;
//             }

//             // Purchase averages
//             if (data.purchases.totalQuantity > 0) {
//                 data.purchases.averagePurchasePrice = data.purchases.totalPurchaseValue / data.purchases.totalQuantity;
//             }

//             // Calculate growth percentages (you can enhance this with historical data)
//             data.sales.growth = 12.5; // Mock data - replace with actual calculation
//             data.purchases.growth = 8.3; // Mock data - replace with actual calculation
//         });

//         // Convert to array and sort by total sales
//         let resultData = Object.values(categoryData).sort((a, b) => b.sales.totalSales - a.sales.totalSales);

//         // Filter by specific category if selected
//         if (category !== 'all') {
//             resultData = resultData.filter(item => item.category === category);
//         }

//         // Calculate overall summary
//         const summary = {
//             totalCategories: resultData.length,
//             totalSales: resultData.reduce((sum, item) => sum + item.sales.totalSales, 0),
//             totalPurchases: resultData.reduce((sum, item) => sum + item.purchases.totalPurchaseValue, 0),
//             totalStockValue: resultData.reduce((sum, item) => sum + item.stock.totalValue, 0),
//             totalProducts: resultData.reduce((sum, item) => sum + item.stock.totalProducts, 0),
//             totalOrders: resultData.reduce((sum, item) => sum + item.sales.totalOrders, 0)
//         };

//         res.status(200).json({
//             success: true,
//             data: {
//                 categories: resultData,
//                 summary,
//                 filters: {
//                     categories: allCategories,
//                     selectedCategory: category
//                 },
//                 dateRange: {
//                     start: dateRange.startDate,
//                     end: dateRange.endDate,
//                     filterType: filter
//                 }
//             }
//         });

//     } catch (error) {
//         console.error("Error generating category analysis:", error);
//         res.status(500).json({
//             success: false,
//             message: "Failed to generate category analysis",
//             error: error.message
//         });
//     }
// });



// Category Analysis Report - UPDATED WITH PRODUCT DATA
router.get("/category-analysis", async (req, res) => {
    try {
        const {
            category = 'all',
            filter = 'month',
            startDate,
            endDate
        } = req.query;

        const dateRange = getDateRange(filter, startDate, endDate);

        // Get all categories from products
        const allCategories = await Inventory.distinct('category');

        // Get sales data from invoices
        const invoices = await Invoice.find({
            createdAt: {
                $gte: dateRange.startDate,
                $lte: dateRange.endDate
            }
        });

        // Get purchase data from inventory price history
        const inventoryItems = await Inventory.find({
            "priceHistory.addedAt": {
                $gte: dateRange.startDate,
                $lte: dateRange.endDate
            }
        });

        // Get current stock data
        const currentInventory = await Inventory.find({});

        // Calculate category-wise data
        const categoryData = {};

        // Initialize all categories
        allCategories.forEach(cat => {
            categoryData[cat] = {
                category: cat,
                sales: {
                    totalSales: 0,
                    totalQuantity: 0,
                    totalOrders: 0,
                    totalTax: 0,
                    totalDiscount: 0,
                    averageOrderValue: 0
                },
                purchases: {
                    totalPurchaseValue: 0,
                    totalQuantity: 0,
                    totalTransactions: 0,
                    averagePurchasePrice: 0
                },
                stock: {
                    totalQuantity: 0,
                    totalValue: 0,
                    totalProducts: 0,
                    lowStockProducts: 0,
                    outOfStockProducts: 0
                },
                products: []
            };
        });

        // Process Sales Data
        invoices.forEach(invoice => {
            invoice.items.forEach(item => {
                if (categoryData[item.category]) {
                    categoryData[item.category].sales.totalSales += item.totalAmount;
                    categoryData[item.category].sales.totalQuantity += item.quantity;
                    categoryData[item.category].sales.totalTax += item.taxAmount;
                    categoryData[item.category].sales.totalDiscount += item.discountAmount;

                    // Add product to category products list if not exists
                    if (!categoryData[item.category].products.includes(item.productId)) {
                        categoryData[item.category].products.push(item.productId);
                    }
                }
            });

            // Count orders per category
            const categoriesInInvoice = [...new Set(invoice.items.map(item => item.category))];
            categoriesInInvoice.forEach(cat => {
                if (categoryData[cat]) {
                    categoryData[cat].sales.totalOrders += 1;
                }
            });
        });

        // Process Purchase Data
        inventoryItems.forEach(item => {
            item.priceHistory.forEach(history => {
                const historyDate = new Date(history.addedAt);
                if (historyDate >= dateRange.startDate && historyDate <= dateRange.endDate) {
                    if (categoryData[item.category]) {
                        const purchaseValue = history.price * history.quantityAdded;
                        categoryData[item.category].purchases.totalPurchaseValue += purchaseValue;
                        categoryData[item.category].purchases.totalQuantity += history.quantityAdded;
                        categoryData[item.category].purchases.totalTransactions += 1;
                    }
                }
            });
        });

        // Process Current Stock Data
        currentInventory.forEach(item => {
            if (categoryData[item.category]) {
                categoryData[item.category].stock.totalQuantity += item.totalQuantity;
                categoryData[item.category].stock.totalValue += (item.totalQuantity * (item.priceHistory[0]?.price || 0));
                categoryData[item.category].stock.totalProducts += 1;

                if (item.totalQuantity === 0) {
                    categoryData[item.category].stock.outOfStockProducts += 1;
                } else if (item.totalQuantity <= 10) {
                    categoryData[item.category].stock.lowStockProducts += 1;
                }
            }
        });

        // Calculate averages and finalize data
        Object.keys(categoryData).forEach(cat => {
            const data = categoryData[cat];

            // Sales averages
            if (data.sales.totalOrders > 0) {
                data.sales.averageOrderValue = data.sales.totalSales / data.sales.totalOrders;
            }

            // Purchase averages
            if (data.purchases.totalQuantity > 0) {
                data.purchases.averagePurchasePrice = data.purchases.totalPurchaseValue / data.purchases.totalQuantity;
            }

            // Calculate growth percentages (you can enhance this with historical data)
            data.sales.growth = 12.5; // Mock data - replace with actual calculation
            data.purchases.growth = 8.3; // Mock data - replace with actual calculation
        });

        // Convert to array and sort by total sales
        let resultData = Object.values(categoryData).sort((a, b) => b.sales.totalSales - a.sales.totalSales);

        // Filter by specific category if selected
        if (category !== 'all') {
            resultData = resultData.filter(item => item.category === category);
        }

        // ========== NEW: GET PRODUCT DETAILS FOR EACH CATEGORY ==========
        const categoryProducts = {};

        for (const categoryObj of resultData) {
            const cat = categoryObj.category;

            // Get all products in this category
            const productsInCategory = await Inventory.find({ category: cat });
            const productSalesData = {};

            // Calculate sales data for each product in this category
            invoices.forEach(invoice => {
                invoice.items.forEach(item => {
                    if (item.category === cat) {
                        if (!productSalesData[item.productId]) {
                            productSalesData[item.productId] = {
                                productId: item.productId,
                                name: item.name,
                                category: item.category,
                                totalSales: 0,
                                totalQuantity: 0,
                                totalOrders: 0,
                                totalTax: 0,
                                totalDiscount: 0
                            };
                        }
                        productSalesData[item.productId].totalSales += item.totalAmount;
                        productSalesData[item.productId].totalQuantity += item.quantity;
                        productSalesData[item.productId].totalTax += item.taxAmount;
                        productSalesData[item.productId].totalDiscount += item.discountAmount;
                    }
                });
            });

            // Count orders per product
            invoices.forEach(invoice => {
                const productsInInvoice = [...new Set(invoice.items.map(item => item.productId))];
                productsInInvoice.forEach(productId => {
                    if (productSalesData[productId]) {
                        productSalesData[productId].totalOrders += 1;
                    }
                });
            });

            // Get purchase data for each product
            const productPurchaseData = {};
            inventoryItems.forEach(item => {
                if (item.category === cat) {
                    if (!productPurchaseData[item.productId]) {
                        productPurchaseData[item.productId] = {
                            totalPurchaseValue: 0,
                            totalQuantity: 0,
                            totalTransactions: 0
                        };
                    }

                    item.priceHistory.forEach(history => {
                        const historyDate = new Date(history.addedAt);
                        if (historyDate >= dateRange.startDate && historyDate <= dateRange.endDate) {
                            const purchaseValue = history.price * history.quantityAdded;
                            productPurchaseData[item.productId].totalPurchaseValue += purchaseValue;
                            productPurchaseData[item.productId].totalQuantity += history.quantityAdded;
                            productPurchaseData[item.productId].totalTransactions += 1;
                        }
                    });
                }
            });

            // Get stock data for each product
            const productStockData = {};
            currentInventory.forEach(item => {
                if (item.category === cat) {
                    productStockData[item.productId] = {
                        totalQuantity: item.totalQuantity,
                        totalValue: item.totalQuantity * (item.priceHistory[0]?.price || 0),
                        currentPrice: item.priceHistory[0]?.price || 0
                    };
                }
            });

            // Combine all product data for this category
            categoryProducts[cat] = productsInCategory.map(product => {
                const sales = productSalesData[product.productId] || {};
                const purchases = productPurchaseData[product.productId] || {};
                const stock = productStockData[product.productId] || {};

                return {
                    productId: product.productId,
                    productName: product.productName,
                    category: product.category,
                    sales: {
                        totalSales: sales.totalSales || 0,
                        totalQuantity: sales.totalQuantity || 0,
                        totalOrders: sales.totalOrders || 0,
                        totalTax: sales.totalTax || 0,
                        totalDiscount: sales.totalDiscount || 0,
                        averageOrderValue: sales.totalOrders > 0 ? (sales.totalSales / sales.totalOrders) : 0
                    },
                    purchases: {
                        totalPurchaseValue: purchases.totalPurchaseValue || 0,
                        totalQuantity: purchases.totalQuantity || 0,
                        totalTransactions: purchases.totalTransactions || 0,
                        averagePurchasePrice: purchases.totalQuantity > 0 ? (purchases.totalPurchaseValue / purchases.totalQuantity) : 0
                    },
                    stock: {
                        totalQuantity: stock.totalQuantity || 0,
                        totalValue: stock.totalValue || 0,
                        currentPrice: stock.currentPrice || 0
                    }
                };
            });
        }
        // ========== END OF NEW PRODUCT DATA CODE ==========

        // Calculate overall summary
        const summary = {
            totalCategories: resultData.length,
            totalSales: resultData.reduce((sum, item) => sum + item.sales.totalSales, 0),
            totalPurchases: resultData.reduce((sum, item) => sum + item.purchases.totalPurchaseValue, 0),
            totalStockValue: resultData.reduce((sum, item) => sum + item.stock.totalValue, 0),
            totalProducts: resultData.reduce((sum, item) => sum + item.stock.totalProducts, 0),
            totalOrders: resultData.reduce((sum, item) => sum + item.sales.totalOrders, 0)
        };

        res.status(200).json({
            success: true,
            data: {
                categories: resultData,
                categoryProducts: categoryProducts, // NEW: Added product data
                summary,
                filters: {
                    categories: allCategories,
                    selectedCategory: category
                },
                dateRange: {
                    start: dateRange.startDate,
                    end: dateRange.endDate,
                    filterType: filter
                }
            }
        });

    } catch (error) {
        console.error("Error generating category analysis:", error);
        res.status(500).json({
            success: false,
            message: "Failed to generate category analysis",
            error: error.message
        });
    }
});

// Trending Products Report
router.get("/trending-products", async (req, res) => {
    try {
        const {
            category = 'all',
            filter = 'month',
            startDate,
            endDate,
            limit = 10
        } = req.query;

        const dateRange = getDateRange(filter, startDate, endDate);

        // Get invoices within date range
        const invoices = await Invoice.find({
            createdAt: {
                $gte: dateRange.startDate,
                $lte: dateRange.endDate
            }
        });

        // Calculate product sales data
        const productSales = {};
        const productDetails = {};

        invoices.forEach(invoice => {
            invoice.items.forEach(item => {
                // Filter by category if specified
                if (category !== 'all' && item.category !== category) {
                    return;
                }

                if (!productSales[item.productId]) {
                    productSales[item.productId] = {
                        productId: item.productId,
                        name: item.name,
                        category: item.category,
                        totalQuantity: 0,
                        totalRevenue: 0,
                        totalOrders: 0,
                        averagePrice: 0,
                        totalDiscount: 0,
                        totalTax: 0,
                        timesSold: 0,
                        uniqueCustomers: new Set(),
                        firstSold: new Date(),
                        lastSold: new Date()
                    };
                    productDetails[item.productId] = {
                        barcode: item.barcode,
                        hsn: item.hsn,
                        price: item.price,
                        taxSlab: item.taxSlab
                    };
                }

                const product = productSales[item.productId];

                product.totalQuantity += item.quantity;
                product.totalRevenue += item.totalAmount;
                product.totalDiscount += item.discountAmount;
                product.totalTax += item.taxAmount;
                product.timesSold += 1;
                product.uniqueCustomers.add(invoice.customer.customerId);

                // Track first and last sale dates
                const saleDate = new Date(invoice.createdAt);
                if (saleDate < product.firstSold) {
                    product.firstSold = saleDate;
                }
                if (saleDate > product.lastSold) {
                    product.lastSold = saleDate;
                }

                // Count orders (invoices) containing this product
                if (!product.ordersSet) {
                    product.ordersSet = new Set();
                }
                product.ordersSet.add(invoice.invoiceNumber);
            });
        });

        // Convert Set sizes to numbers and calculate averages
        Object.keys(productSales).forEach(productId => {
            const product = productSales[productId];
            product.totalOrders = product.ordersSet ? product.ordersSet.size : 0;
            product.uniqueCustomerCount = product.uniqueCustomers.size;
            product.averagePrice = product.totalQuantity > 0 ? product.totalRevenue / product.totalQuantity : 0;
            product.averageOrderValue = product.totalOrders > 0 ? product.totalRevenue / product.totalOrders : 0;

            // Calculate sale frequency (times sold per day)
            const daysDiff = Math.max(1, (product.lastSold - product.firstSold) / (1000 * 60 * 60 * 24));
            product.saleFrequency = product.timesSold / daysDiff;

            // Add product details
            Object.assign(product, productDetails[productId]);

            // Clean up temporary sets
            delete product.ordersSet;
            delete product.uniqueCustomers;
        });

        // Convert to array and sort by total quantity sold (most popular first)
        let trendingProducts = Object.values(productSales)
            .sort((a, b) => b.totalQuantity - a.totalQuantity)
            .slice(0, parseInt(limit));

        // Calculate summary statistics
        const summary = {
            totalProducts: trendingProducts.length,
            totalQuantitySold: trendingProducts.reduce((sum, product) => sum + product.totalQuantity, 0),
            totalRevenue: trendingProducts.reduce((sum, product) => sum + product.totalRevenue, 0),
            totalOrders: trendingProducts.reduce((sum, product) => sum + product.totalOrders, 0),
            averageSaleFrequency: trendingProducts.reduce((sum, product) => sum + product.saleFrequency, 0) / trendingProducts.length,
            period: {
                start: dateRange.startDate,
                end: dateRange.endDate,
                filterType: filter
            }
        };

        // Get unique categories for filter dropdown
        const categories = await Invoice.distinct('items.category');

        res.status(200).json({
            success: true,
            data: {
                trendingProducts,
                summary,
                filters: {
                    categories,
                    selectedCategory: category,
                    selectedLimit: parseInt(limit)
                },
                dateRange: {
                    start: dateRange.startDate,
                    end: dateRange.endDate,
                    filterType: filter
                }
            }
        });

    } catch (error) {
        console.error("Error generating trending products report:", error);
        res.status(500).json({
            success: false,
            message: "Failed to generate trending products report",
            error: error.message
        });
    }
});

// Daily Sales Report
router.get("/daily-sales", async (req, res) => {
    try {
        const {
            category = 'all',
            date = new Date().toISOString().split('T')[0] // Default to today
        } = req.query;

        // Calculate date range for the selected day
        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);

        // Get invoices for the selected day
        const invoices = await Invoice.find({
            createdAt: {
                $gte: startDate,
                $lte: endDate
            }
        }).sort({ createdAt: -1 });

        // Calculate daily sales summary
        let dailySummary = {
            totalSales: 0,
            totalItems: 0,
            totalOrders: invoices.length,
            totalTax: 0,
            totalDiscount: 0,
            averageOrderValue: 0,
            paymentMethods: {},
            hourlySales: Array(24).fill(0).map((_, i) => ({ hour: i, sales: 0, orders: 0 })),
            categoryBreakdown: {}
        };

        // Process each invoice
        const salesDetails = [];
        const productSales = {};

        invoices.forEach(invoice => {
            // Update payment method distribution
            dailySummary.paymentMethods[invoice.paymentType] =
                (dailySummary.paymentMethods[invoice.paymentType] || 0) + 1;

            // Update hourly sales
            const hour = new Date(invoice.createdAt).getHours();
            dailySummary.hourlySales[hour].sales += invoice.total;
            dailySummary.hourlySales[hour].orders += 1;

            // Process invoice items
            let invoiceFiltered = false;
            const invoiceItems = [];

            invoice.items.forEach(item => {
                // Filter by category if specified
                if (category !== 'all' && item.category !== category) {
                    invoiceFiltered = true;
                    return;
                }

                // Update category breakdown
                if (!dailySummary.categoryBreakdown[item.category]) {
                    dailySummary.categoryBreakdown[item.category] = {
                        category: item.category,
                        sales: 0,
                        quantity: 0,
                        products: 0
                    };
                }
                dailySummary.categoryBreakdown[item.category].sales += item.totalAmount;
                dailySummary.categoryBreakdown[item.category].quantity += item.quantity;
                dailySummary.categoryBreakdown[item.category].products += 1;

                // Track product sales
                if (!productSales[item.productId]) {
                    productSales[item.productId] = {
                        productId: item.productId,
                        name: item.name,
                        category: item.category,
                        totalQuantity: 0,
                        totalRevenue: 0,
                        timesSold: 0,
                        averagePrice: 0
                    };
                }
                productSales[item.productId].totalQuantity += item.quantity;
                productSales[item.productId].totalRevenue += item.totalAmount;
                productSales[item.productId].timesSold += 1;

                // Add to invoice items
                invoiceItems.push({
                    productId: item.productId,
                    name: item.name,
                    category: item.category,
                    quantity: item.quantity,
                    price: item.price,
                    totalAmount: item.totalAmount,
                    discount: item.discountAmount,
                    tax: item.taxAmount
                });
            });

            // Skip invoice if all items are filtered out
            if (category !== 'all' && invoiceFiltered && invoiceItems.length === 0) {
                return;
            }

            // Add to sales details
            salesDetails.push({
                invoiceNumber: invoice.invoiceNumber,
                customer: invoice.customer,
                paymentType: invoice.paymentType,
                date: invoice.createdAt,
                total: invoice.total,
                tax: invoice.tax,
                discount: invoice.discount,
                items: invoiceItems,
                subtotal: invoice.subtotal
            });

            // Update summary totals
            dailySummary.totalSales += invoice.total;
            dailySummary.totalTax += invoice.tax;
            dailySummary.totalDiscount += invoice.discount;
            dailySummary.totalItems += invoiceItems.reduce((sum, item) => sum + item.quantity, 0);
        });

        // Calculate averages
        if (dailySummary.totalOrders > 0) {
            dailySummary.averageOrderValue = dailySummary.totalSales / dailySummary.totalOrders;
        }

        // Calculate product averages
        Object.keys(productSales).forEach(productId => {
            const product = productSales[productId];
            product.averagePrice = product.totalQuantity > 0 ? product.totalRevenue / product.totalQuantity : 0;
        });

        // Convert objects to arrays and sort
        const topProducts = Object.values(productSales)
            .sort((a, b) => b.totalRevenue - a.totalRevenue)
            .slice(0, 10);

        const categoryBreakdown = Object.values(dailySummary.categoryBreakdown)
            .sort((a, b) => b.sales - a.sales);

        const paymentMethods = Object.entries(dailySummary.paymentMethods)
            .map(([method, count]) => ({
                method,
                count,
                percentage: ((count / dailySummary.totalOrders) * 100).toFixed(1)
            }));

        // Get unique categories for filter
        const categories = await Invoice.distinct('items.category');

        res.status(200).json({
            success: true,
            data: {
                date: date,
                summary: dailySummary,
                sales: salesDetails,
                topProducts,
                categoryBreakdown,
                paymentMethods,
                hourlySales: dailySummary.hourlySales.filter(hour => hour.sales > 0 || hour.orders > 0),
                filters: {
                    categories,
                    selectedCategory: category,
                    selectedDate: date
                }
            }
        });

    } catch (error) {
        console.error("Error generating daily sales report:", error);
        res.status(500).json({
            success: false,
            message: "Failed to generate daily sales report",
            error: error.message
        });
    }
});

module.exports = router;