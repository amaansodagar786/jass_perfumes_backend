const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const promoCodesSchema = new mongoose.Schema({
    promoId: {
        type: String,
        unique: true,
        default: () => uuidv4(),
    },
    code: {
        type: String,
        required: [true, 'Promo code is required'],
        uppercase: true,
        trim: true,
        index: true
    },
    discount: {
        type: Number,
        required: [true, 'Discount percentage is required'],
        min: [1, 'Discount must be at least 1%'],
        max: [100, 'Discount cannot exceed 100%']
    },
    startDate: {
        type: Date,
        required: [true, 'Start date is required']
    },
    endDate: {
        type: Date,
        required: [true, 'End date is required']
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isExpired: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true,
});

// Create index for better query performance
promoCodesSchema.index({ code: 1 });
promoCodesSchema.index({ isActive: 1 });
promoCodesSchema.index({ endDate: 1 });
promoCodesSchema.index({ isExpired: 1 });

// In your promoCodesSchema, update the pre-save middleware:
promoCodesSchema.pre('save', function (next) {
    const now = new Date();

    // Set to beginning of today for comparison
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Set to beginning of end date
    const endDateOnly = new Date(this.endDate);
    endDateOnly.setHours(0, 0, 0, 0);

    if (endDateOnly < today) {
        this.isExpired = true;
        this.isActive = false;
    } else if (this.startDate > now) {
        this.isActive = false;
        this.isExpired = false;
    } else {
        this.isActive = true;
        this.isExpired = false;
    }
    next();
});

// Update the static method as well:
promoCodesSchema.statics.updateExpiredPromos = async function () {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    await this.updateMany(
        {
            $expr: {
                $lt: [
                    { $dateToString: { format: "%Y-%m-%d", date: "$endDate" } },
                    { $dateToString: { format: "%Y-%m-%d", date: now } }
                ]
            },
            isExpired: false
        },
        {
            isExpired: true,
            isActive: false
        }
    );
};

const PromoCode = mongoose.models.PromoCode || mongoose.model('PromoCode', promoCodesSchema);

module.exports = PromoCode;