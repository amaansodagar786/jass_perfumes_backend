// services/inventoryCleanupService.js
const Inventory = require("../models/inventory");
const ProductDisposal = require("../models/ProductDisposal");

class InventoryCleanupService {
  
  // Main cleanup function
  async performCleanup() {
    try {
      console.log("🔄 Starting automated inventory cleanup...");
      
      const allInventory = await Inventory.find({});
      let totalCleanedBatches = 0;
      const cleanupResults = {
        zeroQuantity: { count: 0, batches: [] },
        expired: { count: 0, batches: [] },
        errors: []
      };

      for (const inventoryItem of allInventory) {
        try {
          const result = await this.cleanupInventoryItem(inventoryItem);
          totalCleanedBatches += result.cleanedBatches;
          
          if (result.zeroQuantityBatches.length > 0) {
            cleanupResults.zeroQuantity.batches.push(...result.zeroQuantityBatches);
            cleanupResults.zeroQuantity.count += result.zeroQuantityBatches.length;
          }
          
          if (result.expiredBatches.length > 0) {
            cleanupResults.expired.batches.push(...result.expiredBatches);
            cleanupResults.expired.count += result.expiredBatches.length;
          }
          
        } catch (error) {
          cleanupResults.errors.push({
            productId: inventoryItem.productId,
            productName: inventoryItem.productName,
            error: error.message
          });
        }
      }

      console.log(`✅ Cleanup completed: ${totalCleanedBatches} batches processed`);
      return cleanupResults;
      
    } catch (error) {
      console.error("❌ Cleanup failed:", error);
      throw error;
    }
  }

  // Cleanup individual inventory item
  async cleanupInventoryItem(inventoryItem) {
    const zeroQuantityBatches = [];
    const expiredBatches = [];
    let cleanedBatches = 0;

    const batchesToRemove = [];
    const currentDate = new Date();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(currentDate.getMonth() - 6);
    
    const oneMonthAfterExpiry = new Date();
    oneMonthAfterExpiry.setMonth(currentDate.getMonth() - 1);

    // Identify batches to remove
    for (const batch of inventoryItem.batches) {
      const batchAddedDate = new Date(batch.addedAt);
      const expiryDate = new Date(batch.expiryDate);
      
      // Condition 1: Zero quantity + older than 6 months
      if (batch.quantity === 0 && batchAddedDate < sixMonthsAgo) {
        zeroQuantityBatches.push({
          batchNumber: batch.batchNumber,
          productId: inventoryItem.productId,
          productName: inventoryItem.productName,
          category: inventoryItem.category,
          manufactureDate: batch.manufactureDate,
          expiryDate: batch.expiryDate,
          originalQuantity: batch.originalQuantity || batch.quantity,
          reason: 'Auto-removed: Zero quantity for more than 6 months',
          removedAt: currentDate
        });
        batchesToRemove.push(batch.batchNumber);
        cleanedBatches++;
      }
      
      // Condition 2: Expired + older than 1 month after expiry
      const oneMonthAfterExpiryDate = new Date(expiryDate);
      oneMonthAfterExpiryDate.setMonth(expiryDate.getMonth() + 1);
      
      if (currentDate > oneMonthAfterExpiryDate && batch.quantity > 0) {
        expiredBatches.push({
          batchNumber: batch.batchNumber,
          productId: inventoryItem.productId,
          productName: inventoryItem.productName,
          category: inventoryItem.category,
          manufactureDate: batch.manufactureDate,
          expiryDate: batch.expiryDate,
          quantity: batch.quantity,
          reason: 'Auto-removed: Expired for more than 1 month',
          removedAt: currentDate
        });
        batchesToRemove.push(batch.batchNumber);
        cleanedBatches++;
      }
    }

    // Remove batches from inventory
    if (batchesToRemove.length > 0) {
      inventoryItem.batches = inventoryItem.batches.filter(
        batch => !batchesToRemove.includes(batch.batchNumber)
      );
      
      // Update total quantity
      inventoryItem.totalQuantity = inventoryItem.batches.reduce(
        (total, batch) => total + batch.quantity, 0
      );
      
      await inventoryItem.save();
      
      // Create disposal records
      await this.createDisposalRecords(zeroQuantityBatches, expiredBatches);
    }

    return {
      cleanedBatches,
      zeroQuantityBatches,
      expiredBatches
    };
  }

  // Create disposal records for removed batches
  async createDisposalRecords(zeroQuantityBatches, expiredBatches) {
    // Group by product for efficient disposal record creation
    const disposalGroups = {};

    const addToDisposalGroup = (batch, type) => {
      if (!disposalGroups[batch.productId]) {
        disposalGroups[batch.productId] = {
          productId: batch.productId,
          productName: batch.productName,
          category: batch.category,
          type: type,
          batches: [],
          totalQuantityDisposed: 0
        };
      }
      
      disposalGroups[batch.productId].batches.push({
        batchNumber: batch.batchNumber,
        quantity: type === 'expired' ? batch.quantity : 0,
        manufactureDate: batch.manufactureDate,
        expiryDate: batch.expiryDate
      });
      
      if (type === 'expired') {
        disposalGroups[batch.productId].totalQuantityDisposed += batch.quantity;
      }
    };

    // Add zero quantity batches
    zeroQuantityBatches.forEach(batch => {
      addToDisposalGroup(batch, 'defective');
    });

    // Add expired batches
    expiredBatches.forEach(batch => {
      addToDisposalGroup(batch, 'expired');
    });

    // Create disposal records
    for (const productId in disposalGroups) {
      const disposalData = disposalGroups[productId];
      
      const disposalRecord = new ProductDisposal({
        ...disposalData,
        reason: 'Automated system cleanup',
        disposedBy: 'system-auto-cleanup'
      });

      await disposalRecord.save();
    }
  }

  // Get cleanup statistics (for reporting)
  async getCleanupStats() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentDisposals = await ProductDisposal.find({
      disposedBy: 'system-auto-cleanup',
      createdAt: { $gte: thirtyDaysAgo }
    });

    const stats = {
      totalDisposals: recentDisposals.length,
      byType: {
        defective: 0,
        expired: 0
      },
      totalQuantity: 0
    };

    recentDisposals.forEach(disposal => {
      stats.byType[disposal.type] = (stats.byType[disposal.type] || 0) + 1;
      stats.totalQuantity += disposal.totalQuantityDisposed;
    });

    return stats;
  }
}

module.exports = new InventoryCleanupService();