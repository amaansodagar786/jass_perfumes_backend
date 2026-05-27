const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Invoice = require("../models/invoiceModel");
const GlobalCounter = require("../models/globalCounter");
const Inventory = require("../models/inventory");
const DeletedInvoice = require("../models/deletedInvoiceModel");
const InvoiceUpdateHistory = require("../models/invoiceUpdateHistory");





// In your create-invoice route - FIXED VERSION
router.post("/create-invoice", async (req, res) => {
  const startTime = Date.now();
  const requestId = `INV_REQ_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let newInvoiceNumber = null;

  try {
    console.log(`🔄 [${requestId}] Starting invoice creation process`);
    console.log(`📥 [${requestId}] Request body summary:`, {
      customer: req.body.customer?.name || 'Unknown',
      itemsCount: req.body.items?.length || 0,
      totalAmount: req.body.total,
      paymentType: req.body.paymentType,
      hasPromo: !!req.body.appliedPromoCode
    });

    // 🛡️ STEP 1: Validate request data FIRST
    if (!req.body.items || req.body.items.length === 0) {
      console.log(`❌ [${requestId}] No items in request`);
      return res.status(400).json({
        success: false,
        message: "Invoice must contain at least one item",
        requestId: requestId
      });
    }

    if (!req.body.customer || !req.body.customer.mobile || !req.body.customer.name) {
      console.log(`❌ [${requestId}] Invalid customer data`);
      return res.status(400).json({
        success: false,
        message: "Customer name and mobile are required",
        requestId: requestId
      });
    }

    // 🛡️ STEP 2: Validate ALL inventory items BEFORE any creation
    console.log(`🔍 [${requestId}] Validating inventory for ${req.body.items.length} items...`);

    const inventoryValidation = [];

    for (const [index, item] of req.body.items.entries()) {
      console.log(`🔍 [${requestId}] Validating item ${index + 1}/${req.body.items.length}:`, {
        productId: item.productId,
        name: item.name,
        batchNumber: item.batchNumber,
        quantity: item.quantity
      });

      // Validate item data
      if (!item.productId || !item.batchNumber || !item.quantity || item.quantity < 1) {
        inventoryValidation.push({
          productId: item.productId,
          productName: item.name,
          error: "Invalid item data - productId, batchNumber and quantity (min 1) are required"
        });
        continue;
      }

      const inventoryItem = await Inventory.findOne({ productId: item.productId });

      if (!inventoryItem) {
        inventoryValidation.push({
          productId: item.productId,
          productName: item.name,
          batchNumber: item.batchNumber,
          error: "Product not found in inventory"
        });
        continue;
      }

      const batch = inventoryItem.batches.find(b => b.batchNumber === item.batchNumber);

      if (!batch) {
        inventoryValidation.push({
          productId: item.productId,
          productName: item.name,
          batchNumber: item.batchNumber,
          error: "Batch not found for this product",
          availableBatches: inventoryItem.batches.map(b => b.batchNumber)
        });
        continue;
      }

      // Check expiry
      const isExpired = new Date(batch.expiryDate) < new Date();
      if (isExpired) {
        inventoryValidation.push({
          productId: item.productId,
          productName: item.name,
          batchNumber: item.batchNumber,
          error: "Batch has expired",
          expiryDate: batch.expiryDate
        });
        continue;
      }

      // Check quantity
      if (batch.quantity < item.quantity) {
        inventoryValidation.push({
          productId: item.productId,
          productName: item.name,
          batchNumber: item.batchNumber,
          error: "Insufficient quantity",
          available: batch.quantity,
          requested: item.quantity,
          shortage: item.quantity - batch.quantity
        });
        continue;
      }

      // Store valid batch for later update
      inventoryValidation.push({
        productId: item.productId,
        productName: item.name,
        batchNumber: item.batchNumber,
        inventoryItem: inventoryItem,
        batch: batch,
        quantity: item.quantity,
        valid: true
      });
    }

    // 🛡️ STEP 3: Check if any validation failed
    const failedValidations = inventoryValidation.filter(item => !item.valid);
    if (failedValidations.length > 0) {
      console.log(`❌ [${requestId}] Inventory validation failed:`, failedValidations);
      return res.status(400).json({
        success: false,
        message: "Inventory validation failed",
        requestId: requestId,
        validationErrors: failedValidations,
        details: {
          totalErrors: failedValidations.length,
          firstError: failedValidations[0]?.error,
          exampleItem: failedValidations[0]?.productName
        }
      });
    }

    console.log(`✅ [${requestId}] All inventory validation passed for ${inventoryValidation.length} items`);

    // 🛡️ STEP 4: Generate invoice number ONLY after validation
    console.log(`🔢 [${requestId}] Generating invoice number...`);
    const counterId = "invoices";
    let counter = await GlobalCounter.findOneAndUpdate(
      { id: counterId },
      { $inc: { count: 1 } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    newInvoiceNumber = `INV${new Date().getFullYear()}${String(counter.count).padStart(4, "0")}`;
    console.log(`✅ [${requestId}] Invoice number generated: ${newInvoiceNumber}`);

    // 🛡️ STEP 5: Prepare invoice data
    const invoiceData = {
      ...req.body,
      invoiceNumber: newInvoiceNumber,
      appliedPromoCode: req.body.appliedPromoCode ? {
        ...req.body.appliedPromoCode,
        appliedAt: new Date()
      } : null,
      promoDiscount: req.body.promoDiscount || 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    console.log(`📄 [${requestId}] Invoice data prepared:`, {
      invoiceNumber: newInvoiceNumber,
      customer: invoiceData.customer?.name,
      itemsCount: invoiceData.items?.length,
      subtotal: invoiceData.subtotal,
      discount: invoiceData.discount,
      promoDiscount: invoiceData.promoDiscount,
      total: invoiceData.total,
      paymentType: invoiceData.paymentType
    });

    // 🛡️ STEP 6: Start database transaction (if using MongoDB transactions)
    // For simplicity, we'll handle rollback manually

    let invoiceCreated = false;
    let inventoryUpdated = false;

    try {
      // 🛡️ STEP 7: Create the invoice
      console.log(`💾 [${requestId}] Saving invoice to database...`);
      const newInvoice = new Invoice(invoiceData);
      await newInvoice.save();
      invoiceCreated = true;
      console.log(`✅ [${requestId}] Invoice saved successfully to database`);

      // 🛡️ STEP 8: Update inventory quantities
      console.log(`📦 [${requestId}] Updating inventory for ${inventoryValidation.length} items...`);

      const inventoryUpdates = [];

      for (const validation of inventoryValidation) {
        if (validation.valid) {
          const oldQuantity = validation.batch.quantity;
          validation.batch.quantity -= validation.quantity;
          const newQuantity = validation.batch.quantity;

          console.log(`🔄 [${requestId}] Updating inventory:`, {
            productName: validation.productName,
            batchNumber: validation.batchNumber,
            quantityChange: -validation.quantity,
            oldQuantity: oldQuantity,
            newQuantity: newQuantity
          });

          inventoryUpdates.push(validation.inventoryItem.save());
        }
      }

      // Wait for all inventory updates to complete
      await Promise.all(inventoryUpdates);
      inventoryUpdated = true;
      console.log(`✅ [${requestId}] All inventory updates completed successfully`);


      console.log('📝 INVOICE CREATED:', {
        invoiceNumber: newInvoiceNumber,
        user: req.body.userDetails ? `${req.body.userDetails.name} (${req.body.userDetails.email})` : 'Unknown User',
        customer: req.body.customer?.name,
        total: req.body.total,
        items: req.body.items?.length,
        timestamp: new Date().toISOString()
      });

      // 🛡️ STEP 9: Calculate processing time and return success
      const processingTime = Date.now() - startTime;

      console.log(`🎉 [${requestId}] Invoice creation completed successfully!`, {
        invoiceNumber: newInvoiceNumber,
        totalItems: newInvoice.items.length,
        customer: newInvoice.customer?.name,
        totalAmount: newInvoice.total,
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString()
      });

      console.log(`📦 [${requestId}] Inventory updates summary:`, {
        itemsProcessed: newInvoice.items.length,
        totalQuantityReduced: newInvoice.items.reduce((sum, item) => sum + item.quantity, 0),
        customer: newInvoice.customer?.name
      });

      res.status(201).json({
        success: true,
        message: "Invoice created successfully",
        data: newInvoice.toObject(),
        requestId: requestId,
        processingTime: `${processingTime}ms`
      });

    } catch (dbError) {
      // 🛡️ STEP 10: Handle database errors with proper rollback
      console.error(`💥 [${requestId}] Database error during invoice creation:`, dbError.message);

      // Rollback logic
      if (invoiceCreated && !inventoryUpdated) {
        console.log(`🔄 [${requestId}] Rolling back - deleting invoice ${newInvoiceNumber}`);
        try {
          await Invoice.findOneAndDelete({ invoiceNumber: newInvoiceNumber });
          console.log(`✅ [${requestId}] Invoice rollback completed`);
        } catch (rollbackError) {
          console.error(`❌ [${requestId}] Invoice rollback failed:`, rollbackError.message);
        }
      }

      // Re-throw to be caught by outer catch block
      throw dbError;
    }

  } catch (error) {
    const processingTime = Date.now() - startTime;

    console.error(`💥 [${requestId}] Error creating invoice:`, {
      error: error.message,
      stack: error.stack,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString()
    });

    console.error(`📋 [${requestId}] Error context:`, {
      invoiceNumber: newInvoiceNumber || 'NOT_GENERATED',
      itemsCount: req.body.items?.length,
      customer: req.body.customer?.name
    });

    res.status(500).json({
      success: false,
      message: "Failed to create invoice",
      error: error.message,
      requestId: requestId,
      processingTime: `${processingTime}ms`
    });
  }
});

// Get all invoices
router.get("/get-invoices", async (req, res) => {
  try {
    const invoices = await Invoice.find({}).sort({ createdAt: -1 });

    // Convert to plain objects to match previous structure
    const plainInvoices = invoices.map(invoice => invoice.toObject());

    res.status(200).json({
      success: true,
      data: plainInvoices
    });
  } catch (error) {
    console.error("Error fetching invoices:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch invoices",
      error: error.message
    });
  }
});

// Get invoice by invoiceNumber
router.get("/get-invoice/:invoiceNumber", async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      invoiceNumber: req.params.invoiceNumber
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found"
      });
    }

    res.status(200).json({
      success: true,
      data: invoice.toObject()
    });
  } catch (error) {
    console.error("Error fetching invoice:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch invoice",
      error: error.message
    });
  }
});


router.delete("/delete-invoice/:invoiceNumber", async (req, res) => {
  try {
    const { invoiceNumber } = req.params;

    console.log(`🔄 Attempting to delete invoice: ${invoiceNumber}`);
    console.log('📋 Request details:', {
      invoiceNumber,
      user: req.body.userDetails ? `${req.body.userDetails.name} (${req.body.userDetails.email})` : 'Unknown User',
      timestamp: new Date().toISOString()
    });

    // Step 1: Find the invoice to be deleted
    const invoiceToDelete = await Invoice.findOne({
      invoiceNumber: invoiceNumber
    });

    if (!invoiceToDelete) {
      console.log('❌ Invoice not found:', invoiceNumber);
      return res.status(404).json({
        success: false,
        message: "Invoice not found"
      });
    }

    console.log('📄 Invoice found for deletion:', {
      invoiceNumber: invoiceToDelete.invoiceNumber,
      customer: invoiceToDelete.customer?.name,
      itemsCount: invoiceToDelete.items.length,
      totalAmount: invoiceToDelete.total
    });

    // Step 2: PHASE 1 - COMPREHENSIVE VALIDATION (No DB changes yet)
    const validationErrors = [];
    const inventoryItemsMap = new Map(); // Store inventory items for later use

    for (const item of invoiceToDelete.items) {
      const inventoryItem = await Inventory.findOne({
        productId: item.productId
      });

      if (!inventoryItem) {
        validationErrors.push({
          productId: item.productId,
          productName: item.name,
          batchNumber: item.batchNumber,
          error: "Product not found in inventory"
        });
        continue;
      }

      const batch = inventoryItem.batches.find(
        b => b.batchNumber === item.batchNumber
      );

      if (!batch) {
        validationErrors.push({
          productId: item.productId,
          productName: item.name,
          batchNumber: item.batchNumber,
          error: "Batch not found for this product"
        });
        continue;
      }

      // Additional validation: Check if batch has required fields
      if (!batch.batchNumber || !batch.expiryDate || !batch.manufactureDate) {
        validationErrors.push({
          productId: item.productId,
          productName: item.name,
          batchNumber: item.batchNumber,
          error: "Batch has missing required fields (batchNumber, expiryDate, or manufactureDate)"
        });
        continue;
      }

      // Store validated inventory item for later use
      inventoryItemsMap.set(item.productId, {
        inventoryItem,
        batch,
        item
      });
    }

    // Step 3: If ANY validation errors, STOP
    if (validationErrors.length > 0) {
      console.log('❌ Validation failed - Invoice deletion cancelled:', {
        invoiceNumber,
        user: req.body.userDetails ? `${req.body.userDetails.name}` : 'Unknown User',
        errors: validationErrors
      });

      return res.status(400).json({
        success: false,
        message: "Cannot delete invoice - validation failed",
        errors: validationErrors,
        details: {
          invoiceNumber: invoiceToDelete.invoiceNumber,
          totalErrors: validationErrors.length,
          failedItems: validationErrors
        }
      });
    }

    console.log('✅ All validations passed successfully - proceeding with deletion');

    // Step 4: PHASE 2 - ALL OPERATIONS

    // 4A: Archive the invoice
    const deletedInvoice = new DeletedInvoice({
      originalInvoiceNumber: invoiceNumber,
      invoiceData: invoiceToDelete.toObject(),
      deletedBy: req.body.userDetails ? `${req.body.userDetails.name} (${req.body.userDetails.email})` : "system",
      archivedAt: new Date()
    });

    await deletedInvoice.save();
    console.log('📁 Invoice archived to deleted invoices collection');

    // 4B: Restore inventory quantities
    const stockRestorationDetails = [];
    const inventoryUpdates = [];

    for (const [productId, data] of inventoryItemsMap) {
      const { inventoryItem, batch, item } = data;

      // Record stock before restoration
      const beforeStock = batch.quantity;

      // Restore the quantity
      batch.quantity += item.quantity;
      const afterStock = batch.quantity;

      // Save stock restoration details
      stockRestorationDetails.push({
        productId: item.productId,
        productName: item.name,
        batchNumber: item.batchNumber,
        quantityRestored: item.quantity,
        beforeDeletionStock: beforeStock,
        afterRestorationStock: afterStock
      });

      console.log(`📦 Inventory restored: ${item.name} (Batch: ${item.batchNumber})`, {
        restoredQuantity: item.quantity,
        before: beforeStock,
        after: afterStock
      });

      // Save inventory item
      inventoryUpdates.push(inventoryItem.save());
    }

    // Wait for all inventory updates
    await Promise.all(inventoryUpdates);
    console.log('✅ All inventory updates completed');

    // 4C: Update deleted invoice with stock restoration details
    deletedInvoice.stockRestoration = {
      restored: true,
      restoredAt: new Date(),
      itemsStockDetails: stockRestorationDetails
    };
    await deletedInvoice.save();

    // 4D: Delete the original invoice
    await Invoice.findOneAndDelete({
      invoiceNumber: invoiceNumber
    });

    console.log('✅ Invoice successfully deleted:', {
      invoiceNumber,
      itemsRestored: stockRestorationDetails.length,
      customer: invoiceToDelete.customer?.name,
      totalAmount: invoiceToDelete.total,
      deletionTime: new Date().toISOString()
    });

    // USER ACTION LOGGING
    console.log('📝 INVOICE DELETED:', {
      invoiceNumber: invoiceNumber,
      user: req.body.userDetails ? `${req.body.userDetails.name} (${req.body.userDetails.email})` : 'Unknown User',
      customer: invoiceToDelete.customer?.name,
      itemsRestored: stockRestorationDetails.length,
      totalAmount: invoiceToDelete.total,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      message: "Invoice deleted successfully and inventory restored",
      restorationDetails: {
        itemsRestored: stockRestorationDetails.length,
        details: stockRestorationDetails
      }
    });

  } catch (error) {
    console.error('💥 Error deleting invoice:', {
      invoiceNumber: req.params.invoiceNumber,
      user: req.body.userDetails ? `${req.body.userDetails.name}` : 'Unknown User',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      message: "Failed to delete invoice",
      error: error.message
    });
  }
});

// Get all deleted invoices
router.get("/get-deleted-invoices", async (req, res) => {
  try {
    const deletedInvoices = await DeletedInvoice.find({})
      .sort({ deletedAt: -1 });

    res.status(200).json({
      success: true,
      data: deletedInvoices
    });
  } catch (error) {
    console.error("Error fetching deleted invoices:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch deleted invoices",
      error: error.message
    });
  }
});

// Get specific deleted invoice
router.get("/get-deleted-invoice/:originalInvoiceNumber", async (req, res) => {
  try {
    const deletedInvoice = await DeletedInvoice.findOne({
      originalInvoiceNumber: req.params.originalInvoiceNumber
    });

    if (!deletedInvoice) {
      return res.status(404).json({
        success: false,
        message: "Deleted invoice not found"
      });
    }

    res.status(200).json({
      success: true,
      data: deletedInvoice
    });
  } catch (error) {
    console.error("Error fetching deleted invoice:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch deleted invoice",
      error: error.message
    });
  }
});

// Update invoice
router.put("/update-invoice/:invoiceNumber", async (req, res) => {
  const startTime = Date.now();
  const requestId = `UPDATE_INV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    const { invoiceNumber } = req.params;
    const { customer, paymentType, remarks } = req.body;

    console.log(`🔄 [${requestId}] Starting invoice update process`);
    console.log(`📥 [${requestId}] Update request details:`, {
      invoiceNumber: invoiceNumber,
      hasCustomerData: !!customer,
      paymentType: paymentType,
      hasRemarks: remarks !== undefined,
      timestamp: new Date().toISOString()
    });

    console.log(`🔍 [${requestId}] Request payload details:`, {
      customer: customer ? {
        name: customer.name,
        mobile: customer.mobile,
        email: customer.email
      } : 'No customer update',
      paymentType: paymentType || 'No payment type update',
      remarks: remarks !== undefined ? (remarks ? `"${remarks}"` : 'Clearing remarks') : 'No remarks update'
    });

    // Check if the invoice exists
    console.log(`🔎 [${requestId}] Checking if invoice exists: ${invoiceNumber}`);
    const existingInvoice = await Invoice.findOne({ invoiceNumber });

    if (!existingInvoice) {
      console.log(`❌ [${requestId}] Invoice not found: ${invoiceNumber}`);
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
        requestId: requestId
      });
    }

    console.log(`✅ [${requestId}] Invoice found:`, {
      invoiceNumber: existingInvoice.invoiceNumber,
      currentCustomer: existingInvoice.customer?.name,
      currentPaymentType: existingInvoice.paymentType,
      currentRemarks: existingInvoice.remarks || 'No remarks',
      totalAmount: existingInvoice.total
    });

    // Build update payload
    const updatePayload = {};
    const changes = [];

    if (paymentType && ["cash", "card", "upi"].includes(paymentType)) {
      if (paymentType !== existingInvoice.paymentType) {
        updatePayload.paymentType = paymentType;
        changes.push(`Payment type: ${existingInvoice.paymentType} → ${paymentType}`);
        console.log(`💰 [${requestId}] Payment type change: ${existingInvoice.paymentType} → ${paymentType}`);
      } else {
        console.log(`ℹ️  [${requestId}] Payment type unchanged: ${paymentType}`);
      }
    }

    if (customer) {
      const customerChanges = [];
      const updatedCustomer = {
        customerId: customer.customerId || existingInvoice.customer.customerId,
        customerNumber: customer.customerNumber || existingInvoice.customer.customerNumber,
        name: customer.name || existingInvoice.customer.name,
        email: customer.email || existingInvoice.customer.email || "",
        mobile: customer.mobile || existingInvoice.customer.mobile,
      };

      // Check for actual changes in customer data
      if (customer.name && customer.name !== existingInvoice.customer.name) {
        customerChanges.push(`Name: ${existingInvoice.customer.name} → ${customer.name}`);
      }
      if (customer.email && customer.email !== existingInvoice.customer.email) {
        customerChanges.push(`Email: ${existingInvoice.customer.email} → ${customer.email}`);
      }
      if (customer.mobile && customer.mobile !== existingInvoice.customer.mobile) {
        customerChanges.push(`Mobile: ${existingInvoice.customer.mobile} → ${customer.mobile}`);
      }

      if (customerChanges.length > 0) {
        updatePayload.customer = updatedCustomer;
        changes.push(...customerChanges);
        console.log(`👤 [${requestId}] Customer updates:`, customerChanges);
      } else {
        console.log(`ℹ️  [${requestId}] No customer data changes detected`);
      }
    }

    // Add remarks handling - allow empty string to clear remarks
    if (remarks !== undefined) {
      const currentRemarks = existingInvoice.remarks || '';
      if (remarks !== currentRemarks) {
        updatePayload.remarks = remarks;
        changes.push(`Remarks: "${currentRemarks}" → "${remarks}"`);
        console.log(`📝 [${requestId}] Remarks change: "${currentRemarks}" → "${remarks}"`);
      } else {
        console.log(`ℹ️  [${requestId}] Remarks unchanged: "${remarks}"`);
      }
    }

    // Check if there are any actual changes
    if (Object.keys(updatePayload).length === 0) {
      console.log(`ℹ️  [${requestId}] No changes detected - update payload empty`);
      return res.status(200).json({
        success: true,
        message: "No changes detected - invoice remains unchanged",
        data: existingInvoice.toObject(),
        requestId: requestId,
        changes: []
      });
    }

    console.log(`📤 [${requestId}] Update payload to be applied:`, updatePayload);
    console.log(`📋 [${requestId}] Total changes: ${changes.length}`, changes);

    // Perform update (Mongoose will auto-update `updatedAt`)
    console.log(`💾 [${requestId}] Saving updates to database...`);
    const updatedInvoice = await Invoice.findOneAndUpdate(
      { invoiceNumber },
      updatePayload,
      {
        new: true, // Return updated document
        runValidators: true // Run schema validators
      }
    );

    console.log('📝 INVOICE UPDATED:', {
      invoiceNumber: updatedInvoice.invoiceNumber,
      user: req.body.userDetails ? `${req.body.userDetails.name} (${req.body.userDetails.email})` : 'Unknown User',
      customer: updatedInvoice.customer?.name,
      changes: changes,
      timestamp: new Date().toISOString()
    });

    // ========== 🆕 NEW CODE ADDED HERE - HISTORY SAVING ==========
    // This ONLY adds history - DOES NOT modify any existing logic
    try {
      const updateId = `UPD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Build field changes array for history
      const fieldChanges = [];

      // Track customer changes
      if (customer) {
        if (customer.name && customer.name !== existingInvoice.customer.name) {
          fieldChanges.push({
            field: 'customer.name',
            oldValue: existingInvoice.customer.name,
            newValue: customer.name,
            fieldType: 'customer'
          });
        }
        if (customer.email && customer.email !== existingInvoice.customer.email) {
          fieldChanges.push({
            field: 'customer.email',
            oldValue: existingInvoice.customer.email || '',
            newValue: customer.email,
            fieldType: 'customer'
          });
        }
        if (customer.mobile && customer.mobile !== existingInvoice.customer.mobile) {
          fieldChanges.push({
            field: 'customer.mobile',
            oldValue: existingInvoice.customer.mobile,
            newValue: customer.mobile,
            fieldType: 'customer'
          });
        }
      }

      // Track payment type changes
      if (paymentType && paymentType !== existingInvoice.paymentType) {
        fieldChanges.push({
          field: 'paymentType',
          oldValue: existingInvoice.paymentType,
          newValue: paymentType,
          fieldType: 'payment'
        });
      }

      // Track remarks changes
      if (remarks !== undefined && remarks !== (existingInvoice.remarks || '')) {
        fieldChanges.push({
          field: 'remarks',
          oldValue: existingInvoice.remarks || '',
          newValue: remarks || '',
          fieldType: 'remarks'
        });
      }

      // Financial changes
      const financialChanges = {
        oldTotal: existingInvoice.total,
        newTotal: updatedInvoice.total,
        difference: updatedInvoice.total - existingInvoice.total
      };

      // Create summary
      const summary = {
        changesCount: fieldChanges.length,
        hasCustomerChanges: fieldChanges.some(f => f.fieldType === 'customer'),
        hasPaymentChanges: fieldChanges.some(f => f.fieldType === 'payment'),
        hasRemarksChanges: fieldChanges.some(f => f.fieldType === 'remarks')
      };

      // Create and save history record
      const updateHistory = new InvoiceUpdateHistory({
        updateId,
        originalInvoiceNumber: invoiceNumber,
        updatedBy: req.body.userDetails || {
          name: 'System',
          email: 'system@example.com'
        },
        fieldChanges,
        financialChanges,
        summary,
        status: 'SUCCESS',
        timestamp: new Date()
      });

      await updateHistory.save();

      console.log(`📚 [${requestId}] Update history saved successfully with ID: ${updateId}`);
      console.log(`📊 [${requestId}] History summary:`, summary);

    } catch (historyError) {
      // ⚠️ CRITICAL: We ONLY log the error - we NEVER fail the main operation
      console.error(`⚠️ [${requestId}] WARNING: Failed to save update history (main operation still successful):`, {
        error: historyError.message,
        invoiceNumber: invoiceNumber
      });

      // Add warning to response but don't change success status
      res.locals.historyWarning = "Invoice updated but history saving failed";
    }
    // ========== 🆕 END OF NEW CODE ==========

    // Calculate processing time
    const processingTime = Date.now() - startTime;

    console.log(`✅ [${requestId}] Invoice updated successfully!`, {
      invoiceNumber: updatedInvoice.invoiceNumber,
      changesApplied: changes.length,
      processingTime: `${processingTime}ms`,
      updatedAt: updatedInvoice.updatedAt,
      customer: updatedInvoice.customer?.name,
      paymentType: updatedInvoice.paymentType
    });

    console.log(`📊 [${requestId}] Final invoice state:`, {
      customer: updatedInvoice.customer?.name,
      mobile: updatedInvoice.customer?.mobile,
      paymentType: updatedInvoice.paymentType,
      remarks: updatedInvoice.remarks || 'No remarks',
      totalAmount: updatedInvoice.total
    });

    // Prepare response
    const response = {
      success: true,
      message: "Invoice updated successfully",
      data: updatedInvoice.toObject(),
      requestId: requestId,
      changes: changes,
      processingTime: `${processingTime}ms`
    };

    // Add history warning if any (without changing success status)
    if (res.locals.historyWarning) {
      response.historyWarning = res.locals.historyWarning;
    }

    res.status(200).json(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;

    console.error(`💥 [${requestId}] Error updating invoice:`, {
      invoiceNumber: req.params.invoiceNumber,
      error: error.message,
      stack: error.stack,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString()
    });

    console.error(`📋 [${requestId}] Error context:`, {
      customerData: req.body.customer ? 'Present' : 'Absent',
      paymentType: req.body.paymentType,
      remarks: req.body.remarks !== undefined ? 'Present' : 'Absent'
    });

    res.status(500).json({
      success: false,
      message: "Failed to update invoice",
      error: error.message,
      requestId: requestId,
      processingTime: `${processingTime}ms`
    });
  }
});


// POST bulk-import-invoices - FIXED VERSION (Groups items by invoice)
router.post("/bulk-import-invoices", async (req, res) => {
  try {
    const { invoices } = req.body;

    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No invoice data provided"
      });
    }

    const results = {
      successful: [],
      failed: []
    };

    // Group invoices by invoiceNumber to handle multiple items
    const invoiceMap = new Map();

    invoices.forEach(invoiceData => {
      const invoiceNumber = invoiceData.invoiceNumber;

      if (!invoiceMap.has(invoiceNumber)) {
        // Create new invoice entry
        invoiceMap.set(invoiceNumber, {
          ...invoiceData,
          items: [] // Initialize empty items array
        });
      }

      // Add all items to the same invoice
      if (invoiceData.items && invoiceData.items.length > 0) {
        invoiceMap.get(invoiceNumber).items.push(...invoiceData.items);
      }
    });

    const groupedInvoices = Array.from(invoiceMap.values());

    // Process each grouped invoice
    for (const invoiceData of groupedInvoices) {
      try {
        const originalInvoiceNumber = invoiceData.invoiceNumber;

        // Check if invoice already exists
        const existingInvoice = await Invoice.findOne({
          invoiceNumber: originalInvoiceNumber
        });

        if (existingInvoice) {
          results.failed.push({
            invoiceNumber: originalInvoiceNumber,
            error: "Invoice already exists"
          });
          continue;
        }

        // Create invoice with all items
        const invoice = new Invoice({
          ...invoiceData,
          invoiceNumber: originalInvoiceNumber,
          createdAt: invoiceData.createdAt || new Date(),
          updatedAt: invoiceData.updatedAt || new Date()
        });

        const savedInvoice = await invoice.save();
        results.successful.push(savedInvoice.toObject());

      } catch (error) {
        results.failed.push({
          invoiceNumber: invoiceData.invoiceNumber || 'Unknown',
          error: error.message
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Bulk import completed: ${results.successful.length} successful, ${results.failed.length} failed`,
      results
    });

  } catch (error) {
    console.error("Error in bulk invoice import:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process bulk invoice import",
      error: error.message
    });
  }
});


// Update invoice products with PROPER RECALCULATION - FIXED VERSION
router.put("/update-invoice-products/:invoiceNumber", async (req, res) => {
  const requestId = `UPDATE_PROD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    const { invoiceNumber } = req.params;
    const { updatedItems, originalItems, userDetails } = req.body;

    console.log(`🔄 [${requestId}] Starting invoice products update with PROPER RECALCULATION`);

    // 🛡️ STEP 1: Validate request data
    if (!updatedItems || !Array.isArray(updatedItems)) {
      throw new Error("Updated items are required and must be an array");
    }

    // Find original invoice
    const originalInvoice = await Invoice.findOne({ invoiceNumber });
    if (!originalInvoice) {
      throw new Error("Invoice not found");
    }

    console.log(`✅ [${requestId}] Original invoice found with total: ${originalInvoice.total}`);

    // ========== 🆕 STEP 2: INVENTORY VALIDATION FOR UPDATES ==========
    console.log(`🔍 [${requestId}] Validating inventory for ${updatedItems.length} items...`);

    const inventoryValidation = [];
    const inventoryItemsMap = new Map(); // Store inventory items for later update

    // First, validate ALL inventory changes
    for (const [index, item] of updatedItems.entries()) {
      const originalItem = originalItems.find(oi =>
        oi.productId === item.productId && oi.batchNumber === item.batchNumber
      );

      // Calculate quantity difference
      let quantityChange = item.quantity;
      if (originalItem) {
        // Existing item - calculate net change
        quantityChange = item.quantity - originalItem.quantity;
      }
      // For new items, quantityChange is positive (need to deduct from inventory)

      console.log(`🔍 [${requestId}] Validating item ${index + 1}/${updatedItems.length}:`, {
        productId: item.productId,
        name: item.name,
        batchNumber: item.batchNumber,
        requestedQty: item.quantity,
        originalQty: originalItem?.quantity || 0,
        netChange: quantityChange,
        isNewItem: !originalItem,
        isRemoved: false
      });

      // Validate item data
      if (!item.productId || !item.batchNumber || !item.quantity || item.quantity < 1) {
        inventoryValidation.push({
          productId: item.productId,
          productName: item.name,
          error: "Invalid item data - productId, batchNumber and quantity (min 1) are required"
        });
        continue;
      }

      const inventoryItem = await Inventory.findOne({ productId: item.productId });
      if (!inventoryItem) {
        inventoryValidation.push({
          productId: item.productId,
          productName: item.name,
          batchNumber: item.batchNumber,
          error: "Product not found in inventory"
        });
        continue;
      }

      const batch = inventoryItem.batches.find(b => b.batchNumber === item.batchNumber);
      if (!batch) {
        inventoryValidation.push({
          productId: item.productId,
          productName: item.name,
          batchNumber: item.batchNumber,
          error: "Batch not found for this product",
          availableBatches: inventoryItem.batches.map(b => b.batchNumber)
        });
        continue;
      }

      // Check expiry
      const isExpired = new Date(batch.expiryDate) < new Date();
      if (isExpired) {
        inventoryValidation.push({
          productId: item.productId,
          productName: item.name,
          batchNumber: item.batchNumber,
          error: "Batch has expired",
          expiryDate: batch.expiryDate
        });
        continue;
      }

      // CRITICAL: Check if we have enough quantity for the INCREASE
      if (quantityChange > 0) {
        // We need to deduct more from inventory
        if (batch.quantity < quantityChange) {
          inventoryValidation.push({
            productId: item.productId,
            productName: item.name,
            batchNumber: item.batchNumber,
            error: "Insufficient quantity for increase",
            available: batch.quantity,
            requested: quantityChange,
            shortage: quantityChange - batch.quantity
          });
          continue;
        }
      }

      // Store valid inventory item for later update
      inventoryItemsMap.set(`${item.productId}_${item.batchNumber}`, {
        inventoryItem,
        batch,
        item,
        originalItem,
        quantityChange
      });

      inventoryValidation.push({
        productId: item.productId,
        productName: item.name,
        batchNumber: item.batchNumber,
        valid: true
      });
    }

    // Validate removed items (they will increase inventory, so no quantity check needed)
    const removedItems = originalItems.filter(oi =>
      !updatedItems.some(ui =>
        ui.productId === oi.productId && ui.batchNumber === oi.batchNumber
      )
    );

    for (const removedItem of removedItems) {
      console.log(`🔍 [${requestId}] Processing removed item:`, {
        productId: removedItem.productId,
        name: removedItem.name,
        batchNumber: removedItem.batchNumber,
        quantity: removedItem.quantity
      });

      const inventoryItem = await Inventory.findOne({ productId: removedItem.productId });
      if (!inventoryItem) {
        inventoryValidation.push({
          productId: removedItem.productId,
          productName: removedItem.name,
          batchNumber: removedItem.batchNumber,
          error: "Product not found in inventory - cannot restore stock"
        });
        continue;
      }

      const batch = inventoryItem.batches.find(b => b.batchNumber === removedItem.batchNumber);
      if (!batch) {
        inventoryValidation.push({
          productId: removedItem.productId,
          productName: removedItem.name,
          batchNumber: removedItem.batchNumber,
          error: "Batch not found in inventory - cannot restore stock"
        });
        continue;
      }

      // Store removed item for inventory update (will add back)
      inventoryItemsMap.set(`${removedItem.productId}_${removedItem.batchNumber}_REMOVED`, {
        inventoryItem,
        batch,
        item: removedItem,
        quantityChange: removedItem.quantity, // Positive change (add back)
        isRemoved: true
      });

      inventoryValidation.push({
        productId: removedItem.productId,
        productName: removedItem.name,
        batchNumber: removedItem.batchNumber,
        valid: true,
        isRemoved: true
      });
    }

    // Check if any validation failed
    const failedValidations = inventoryValidation.filter(item => !item.valid);
    if (failedValidations.length > 0) {
      console.log(`❌ [${requestId}] Inventory validation failed:`, failedValidations);
      return res.status(400).json({
        success: false,
        message: "Inventory validation failed",
        requestId: requestId,
        validationErrors: failedValidations,
        details: {
          totalErrors: failedValidations.length,
          firstError: failedValidations[0]?.error
        }
      });
    }

    console.log(`✅ [${requestId}] All inventory validation passed`);
    // ========== 🆕 END OF INVENTORY VALIDATION ==========

    // 🛡️ STEP 3: PROPERLY RECALCULATE ALL TOTALS FROM SCRATCH
    console.log(`🧮 [${requestId}] Recalculating ALL invoice totals from scratch...`);

    let newSubtotal = 0;
    let newTotalDiscount = 0;
    let amountAfterItemDiscounts = 0;

    // Calculate item-level totals
    const recalculatedItems = updatedItems.map(item => {
      const quantity = item.quantity || 1;
      const price = item.price || 0;
      const discountPercent = item.discount || 0;
      const taxRate = item.taxSlab || 18;

      // Calculate item totals
      const itemTotalBeforeDiscount = price * quantity;
      const itemDiscountAmount = itemTotalBeforeDiscount * (discountPercent / 100);
      const itemTotalAfterDiscount = itemTotalBeforeDiscount - itemDiscountAmount;

      newSubtotal += itemTotalBeforeDiscount;
      newTotalDiscount += itemDiscountAmount;
      amountAfterItemDiscounts += itemTotalAfterDiscount;

      // Calculate tax components
      const baseValue = itemTotalAfterDiscount / (1 + taxRate / 100);
      const taxAmount = itemTotalAfterDiscount - baseValue;
      const cgstAmount = taxAmount / 2;
      const sgstAmount = taxAmount / 2;

      return {
        ...item,
        baseValue: parseFloat(baseValue.toFixed(2)),
        discountAmount: parseFloat(itemDiscountAmount.toFixed(2)),
        taxAmount: parseFloat(taxAmount.toFixed(2)),
        cgstAmount: parseFloat(cgstAmount.toFixed(2)),
        sgstAmount: parseFloat(sgstAmount.toFixed(2)),
        totalAmount: parseFloat(itemTotalAfterDiscount.toFixed(2)),
        finalAmount: parseFloat(itemTotalAfterDiscount.toFixed(2))
      };
    });

    console.log(`📊 [${requestId}] Basic calculations:`, {
      newSubtotal,
      newTotalDiscount,
      amountAfterItemDiscounts
    });

    // 🛡️ STEP 4: RECALCULATE PROMO DISCOUNT
    let newPromoDiscount = 0;
    if (originalInvoice.appliedPromoCode && originalInvoice.appliedPromoCode.discount) {
      const promoDiscountPercent = Number(originalInvoice.appliedPromoCode.discount) || 0;

      if (promoDiscountPercent > 0) {
        newPromoDiscount = amountAfterItemDiscounts * (promoDiscountPercent / 100);
        console.log(`🎫 [${requestId}] Recalculated promo discount: ${newPromoDiscount} (${promoDiscountPercent}% of ${amountAfterItemDiscounts})`);
      }
    }

    const amountAfterPromo = amountAfterItemDiscounts - newPromoDiscount;

    // 🛡️ STEP 5: RECALCULATE LOYALTY DISCOUNT
    let newLoyaltyDiscount = 0;
    if (originalInvoice.loyaltyCoinsUsed && originalInvoice.loyaltyCoinsUsed > 0) {
      newLoyaltyDiscount = Math.min(originalInvoice.loyaltyCoinsUsed, amountAfterPromo);
    }

    const newGrandTotal = amountAfterPromo - newLoyaltyDiscount;

    // 🛡️ STEP 6: Calculate base value and loyalty coins
    const newBaseValue = recalculatedItems.reduce((sum, item) => sum + (item.baseValue || 0), 0);
    const newLoyaltyCoinsEarned = Math.floor(newBaseValue / 100);

    // 🛡️ STEP 7: Create COMPLETE updated invoice data
    const updatedInvoiceData = {
      items: recalculatedItems,
      subtotal: parseFloat(newSubtotal.toFixed(2)),
      baseValue: parseFloat(newBaseValue.toFixed(2)),
      discount: parseFloat(newTotalDiscount.toFixed(2)),
      promoDiscount: parseFloat(newPromoDiscount.toFixed(2)),
      loyaltyDiscount: parseFloat(newLoyaltyDiscount.toFixed(2)),
      total: parseFloat(newGrandTotal.toFixed(2)),
      loyaltyCoinsEarned: newLoyaltyCoinsEarned,
      updatedAt: new Date()
    };

    if (originalInvoice.appliedPromoCode) {
      updatedInvoiceData.appliedPromoCode = originalInvoice.appliedPromoCode;
    }
    if (originalInvoice.loyaltyCoinsUsed) {
      updatedInvoiceData.loyaltyCoinsUsed = originalInvoice.loyaltyCoinsUsed;
    }

    // ========== 🆕 STEP 8: UPDATE INVENTORY FIRST ==========
    console.log(`📦 [${requestId}] Updating inventory quantities...`);

    const inventoryUpdates = [];

    // Update inventory for changed/added items
    for (const [key, data] of inventoryItemsMap) {
      if (data.isRemoved) {
        // Removed item - ADD BACK to inventory
        const oldQuantity = data.batch.quantity;
        data.batch.quantity += data.quantityChange;

        console.log(`🔄 [${requestId}] Restoring removed item to inventory:`, {
          productName: data.item.name,
          batchNumber: data.item.batchNumber,
          quantityRestored: data.quantityChange,
          oldQuantity: oldQuantity,
          newQuantity: data.batch.quantity
        });

        inventoryUpdates.push(data.inventoryItem.save());
      } else if (data.quantityChange !== 0) {
        // Existing item with quantity change
        const oldQuantity = data.batch.quantity;
        data.batch.quantity -= data.quantityChange; // Negative change = add back, Positive change = deduct

        console.log(`🔄 [${requestId}] Updating inventory quantity:`, {
          productName: data.item.name,
          batchNumber: data.item.batchNumber,
          changeType: data.quantityChange > 0 ? 'DEDUCT' : 'ADD BACK',
          quantityChange: -data.quantityChange,
          oldQuantity: oldQuantity,
          newQuantity: data.batch.quantity
        });

        inventoryUpdates.push(data.inventoryItem.save());
      }
    }

    // Wait for all inventory updates
    await Promise.all(inventoryUpdates);
    console.log(`✅ [${requestId}] All inventory updates completed successfully`);
    // ========== 🆕 END OF INVENTORY UPDATE ==========

    // 🛡️ STEP 9: Update the invoice
    console.log(`💾 [${requestId}] Saving invoice updates to database...`);
    const updatedInvoice = await Invoice.findOneAndUpdate(
      { invoiceNumber },
      updatedInvoiceData,
      { new: true, runValidators: true }
    );

    if (!updatedInvoice) {
      throw new Error("Failed to update invoice");
    }

    console.log(`✅ [${requestId}] Invoice updated successfully!`);

    // ========== 🆕 HISTORY SAVING (same as before) ==========
    try {
      const updateId = `PROD_UPD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Track items that were added
      const itemsAdded = updatedItems.filter(updatedItem =>
        !originalItems.some(originalItem =>
          originalItem.productId === updatedItem.productId &&
          originalItem.batchNumber === updatedItem.batchNumber
        )
      ).map(item => ({
        productId: item.productId,
        productName: item.name,
        batchNumber: item.batchNumber,
        quantity: item.quantity,
        price: item.price,
        taxSlab: item.taxSlab,
        discount: item.discount
      }));

      // Track items that were removed
      const itemsRemoved = originalItems.filter(originalItem =>
        !updatedItems.some(updatedItem =>
          updatedItem.productId === originalItem.productId &&
          updatedItem.batchNumber === originalItem.batchNumber
        )
      ).map(item => ({
        productId: item.productId,
        productName: item.name,
        batchNumber: item.batchNumber,
        quantity: item.quantity,
        price: item.price
      }));

      // Track items that were modified
      const itemsModified = [];

      updatedItems.forEach(updatedItem => {
        const originalItem = originalItems.find(oi =>
          oi.productId === updatedItem.productId &&
          oi.batchNumber === updatedItem.batchNumber
        );

        if (originalItem) {
          const changes = [];

          if (originalItem.quantity !== updatedItem.quantity) {
            changes.push({
              field: 'quantity',
              oldValue: originalItem.quantity,
              newValue: updatedItem.quantity
            });
          }
          if (originalItem.price !== updatedItem.price) {
            changes.push({
              field: 'price',
              oldValue: originalItem.price,
              newValue: updatedItem.price
            });
          }
          if (originalItem.discount !== updatedItem.discount) {
            changes.push({
              field: 'discount',
              oldValue: originalItem.discount,
              newValue: updatedItem.discount
            });
          }

          if (changes.length > 0) {
            itemsModified.push({
              productId: updatedItem.productId,
              productName: updatedItem.name,
              batchNumber: updatedItem.batchNumber,
              changes: changes
            });
          }
        }
      });

      const financialChanges = {
        oldTotal: originalInvoice.total,
        newTotal: updatedInvoice.total,
        oldSubtotal: originalInvoice.subtotal,
        newSubtotal: updatedInvoice.subtotal,
        oldDiscount: originalInvoice.discount,
        newDiscount: updatedInvoice.discount,
        difference: updatedInvoice.total - originalInvoice.total
      };

      const updateHistory = new InvoiceUpdateHistory({
        updateId,
        originalInvoiceNumber: invoiceNumber,
        updatedBy: userDetails || { name: 'System', email: 'system@example.com' },
        itemsChanges: {
          added: itemsAdded,
          removed: itemsRemoved,
          modified: itemsModified
        },
        financialChanges,
        summary: {
          changesCount: itemsAdded.length + itemsRemoved.length + itemsModified.length,
          hasCustomerChanges: false,
          hasPaymentChanges: false,
          hasRemarksChanges: false,
          hasItemChanges: true,
          hasFinancialChanges: true
        },
        status: 'SUCCESS',
        timestamp: new Date()
      });

      await updateHistory.save();

      console.log(`📚 [${requestId}] Product update history saved successfully with ID: ${updateId}`);
      console.log(`📊 [${requestId}] Product changes summary:`, {
        added: itemsAdded.length,
        removed: itemsRemoved.length,
        modified: itemsModified.length
      });

    } catch (historyError) {
      console.error(`⚠️ [${requestId}] WARNING: Failed to save product update history:`, historyError.message);
    }

    res.status(200).json({
      success: true,
      message: "Invoice products updated successfully with proper recalculation and inventory sync",
      data: updatedInvoice,
      calculationSummary: {
        oldTotal: originalInvoice.total,
        newTotal: updatedInvoice.total,
        difference: (originalInvoice.total - updatedInvoice.total).toFixed(2),
        itemsRecalculated: recalculatedItems.length
      }
    });

  } catch (error) {
    console.error(`💥 [${requestId}] Error in invoice products update:`, error);

    res.status(500).json({
      success: false,
      message: "Failed to update invoice products",
      error: error.message,
      requestId: requestId
    });
  }
});

module.exports = router;