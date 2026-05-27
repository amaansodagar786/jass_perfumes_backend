const express = require("express");
const router = express.Router();
const PromoCode = require("../models/promoCode");

// In your create-promo route:
router.post("/create-promo", async (req, res) => {
    try {
        const { code, discount, startDate, endDate } = req.body;

        // Validate required fields
        if (!code || !discount || !startDate || !endDate) {
            return res.status(400).json({
                message: "Code, discount, start date and end date are required"
            });
        }

        // Validate discount range
        const discountValue = Number(discount);
        if (isNaN(discountValue) || discountValue < 1 || discountValue > 100) {
            return res.status(400).json({
                message: "Discount must be a number between 1 and 100"
            });
        }

        let start = new Date(startDate);
        let end = new Date(endDate);
        const now = new Date();

        // Allow same day promos (start date can be equal to end date)
        if (start > end) {
            return res.status(400).json({
                message: "End date cannot be before start date"
            });
        }

        // FOR ALL END DATES: Set to 23:59:59 of the selected end date
        end.setHours(23, 59, 59, 999);

        // Compare dates without time for validation
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDateOnly = new Date(end);
        endDateOnly.setHours(0, 0, 0, 0);

        // Allow today's date and future dates
        if (endDateOnly < today) {
            return res.status(400).json({
                message: "End date cannot be in the past"
            });
        }

        // Check if code already exists
        const existingCode = await PromoCode.findOne({ code: code.toUpperCase() });
        if (existingCode) {
            return res.status(400).json({
                message: "Promo code already exists"
            });
        }

        // Create promo code
        const promoCode = new PromoCode({
            code: code.toUpperCase(),
            discount: discountValue,
            startDate: start,
            endDate: end
        });

        const savedPromo = await promoCode.save();

        res.status(201).json({
            message: "Promo code created successfully",
            promoCode: savedPromo.toObject()
        });
    } catch (error) {
        console.error("Error creating promo code:", error);
        res.status(500).json({
            message: "Failed to create promo code",
            error: error.message
        });
    }
});

// Similarly update the update-promo route:
router.put("/update-promo/:promoId", async (req, res) => {
    try {
        const { promoId } = req.params;
        const { code, discount, startDate, endDate, isActive } = req.body;

        // Validate discount if provided
        if (discount !== undefined) {
            const discountValue = Number(discount);
            if (isNaN(discountValue) || discountValue < 1 || discountValue > 100) {
                return res.status(400).json({
                    message: "Discount must be a number between 1 and 100"
                });
            }
        }

        // Validate dates if provided
        if (startDate && endDate) {
            let start = new Date(startDate);
            let end = new Date(endDate);
            const now = new Date();

            // Allow same day promos (start date can be equal to end date)
            if (start > end) {
                return res.status(400).json({
                    message: "End date cannot be before start date"
                });
            }

            // FOR ALL END DATES: Set to 23:59:59 of the selected end date
            end.setHours(23, 59, 59, 999);

            // Compare dates without time for validation
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const endDateOnly = new Date(end);
            endDateOnly.setHours(0, 0, 0, 0);

            // Allow today's date and future dates
            if (endDateOnly < today) {
                return res.status(400).json({
                    message: "End date cannot be in the past"
                });
            }
        }

        const updateData = {};
        if (code) updateData.code = code.toUpperCase();
        if (discount !== undefined) updateData.discount = Number(discount);
        if (startDate) {
            let start = new Date(startDate);
            updateData.startDate = start;
        }
        if (endDate) {
            let end = new Date(endDate);
            // FOR ALL END DATES: Set to 23:59:59
            end.setHours(23, 59, 59, 999);
            updateData.endDate = end;
        }
        if (isActive !== undefined) updateData.isActive = isActive;

        // Check for duplicate code (excluding current promo)
        if (code) {
            const existingCode = await PromoCode.findOne({
                code: code.toUpperCase(),
                promoId: { $ne: promoId }
            });
            if (existingCode) {
                return res.status(400).json({
                    message: "Promo code already exists"
                });
            }
        }

        const updatedPromo = await PromoCode.findOneAndUpdate(
            { promoId: promoId },
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedPromo) {
            return res.status(404).json({
                message: "Promo code not found"
            });
        }

        res.status(200).json({
            message: "Promo code updated successfully",
            promoCode: updatedPromo.toObject()
        });
    } catch (error) {
        console.error("Error updating promo code:", error);
        res.status(500).json({
            message: "Failed to update promo code",
            error: error.message
        });
    }
});


router.get("/get-promos", async (req, res) => {
    try {
        // Update expired promos before fetching
        await PromoCode.updateExpiredPromos();

        const promoCodes = await PromoCode.find({}).sort({ createdAt: -1 });
        const plainPromos = promoCodes.map(promo => promo.toObject());
        res.status(200).json(plainPromos);
    } catch (error) {
        console.error("Error fetching promo codes:", error);
        res.status(500).json({
            message: "Failed to fetch promo codes",
            error: error.message
        });
    }
});


// Delete promo code
router.delete("/delete-promo/:promoId", async (req, res) => {
    try {
        const { promoId } = req.params;

        const deletedPromo = await PromoCode.findOneAndDelete({ promoId: promoId });

        if (!deletedPromo) {
            return res.status(404).json({
                message: "Promo code not found"
            });
        }

        res.status(200).json({
            message: "Promo code deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting promo code:", error);
        res.status(500).json({
            message: "Failed to delete promo code",
            error: error.message
        });
    }
});

router.get("/validate-promo/:code", async (req, res) => {
    try {
        const { code } = req.params;

        if (!code) {
            return res.status(400).json({
                isValid: false,
                message: "Promo code is required"
            });
        }

        // Update expired promos before validation
        await PromoCode.updateExpiredPromos();

        // First check if code exists at all
        const promoCode = await PromoCode.findOne({
            code: code.toUpperCase()
        });

        if (!promoCode) {
            return res.status(200).json({
                isValid: false,
                message: "Invalid promo code. Please check the spelling."
            });
        }

        // Check if code is active
        if (!promoCode.isActive) {
            return res.status(200).json({
                isValid: false,
                message: "This promo code is currently inactive."
            });
        }

        // Check if code is expired
        if (promoCode.isExpired) {
            return res.status(200).json({
                isValid: false,
                message: "This promo code has expired."
            });
        }

        // Check date validity
        const now = new Date();
        if (promoCode.startDate > now) {
            return res.status(200).json({
                isValid: false,
                message: "This promo code is not yet active."
            });
        }

        if (promoCode.endDate < now) {
            return res.status(200).json({
                isValid: false,
                message: "This promo code has expired."
            });
        }

        // If all checks pass
        res.status(200).json({
            isValid: true,
            promoCode: {
                code: promoCode.code,
                discount: promoCode.discount,
                promoId: promoCode.promoId,
                startDate: promoCode.startDate,
                endDate: promoCode.endDate,
                description: promoCode.description
            }
        });
    } catch (error) {
        console.error("Error validating promo code:", error);
        res.status(500).json({
            isValid: false,
            message: "Failed to validate promo code"
        });
    }
});


// Add this route to your promoCode routes
router.get("/get-active-promos", async (req, res) => {
    try {
        // Update expired promos before fetching
        await PromoCode.updateExpiredPromos();

        const activePromos = await PromoCode.find({
            isActive: true,
            isExpired: false,
            startDate: { $lte: new Date() },
            endDate: { $gte: new Date() }
        }).sort({ discount: -1 });

        const plainPromos = activePromos.map(promo => promo.toObject());
        res.status(200).json(plainPromos);
    } catch (error) {
        console.error("Error fetching active promo codes:", error);
        res.status(500).json({
            message: "Failed to fetch active promo codes",
            error: error.message
        });
    }
});

module.exports = router;