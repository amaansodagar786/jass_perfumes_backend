const dynamoose = require("dynamoose");

const salesSchema = new dynamoose.Schema(
  {
    invoiceNumber: {
      type: String,
      hashKey: true,
      required: true,
    },
    workOrderNumber: String,
    invoiceDate: String,
    poNumber: String,
    poDate: String,

    receiver: {
      type: Object,
      schema: {
        customerId: String,
        companyName: String,
        name: String,
        gstin: String,
        address: String,
        city: String,
        pincode: String,
        contact: String,
        email: String,
      },
    },
    consignee: {
      type: Object,
      schema: {
        name: String,
        gstin: String,
        address: String,
        city: String,
        pincode: String,
        contact: String,
        email: String,
      },
    },

    items: {
      type: Array,
      schema: [
        {
          type: Object,
          schema: {
            bomId: String,
            name: String,
            description: String,
            hsn: String,
            quantity: Number,
            unitPrice: Number,
            units: String,
          },
        },
      ],
    },

    lrNumber: String,
    lrDate: String,
    transporter: String,
    vehicleNumber: String,
    transportMobile: String,
    imageUrl: String,

    // bank: {
    //   type: Object,
    //   schema: {
    //     name: String,
    //     account: String,
    //     branch: String,
    //     ifsc: String,
    //   },
    // },

    otherCharges: Number,
    extraNote: String,
    terms: String,
    packetForwardingPercent: { type: Number, default: 0 },
    freightPercent: { type: Number, default: 0 },
    inspectionPercent: { type: Number, default: 0 },
    tcsPercent: { type: Number, default: 0 },

    loyaltyCoinsEarned: {
      type: Number,
      default: 0,
      min: 0
    },

    // 🔹 NEW: Promo Code Details
    appliedPromoCode: {
      type: Object,
      schema: {
        promoId: String,
        code: String,
        discount: Number,
        description: String,
        appliedAt: String
      }
    },
    
    promoDiscount: {
      type: Number,
      default: 0,
      min: 0
    },

    subtotal: Number,
    taxSlab: Number,
    cgst: Number,
    sgst: Number,
    igst: Number,
    total: Number,

    pdfUrl: String,

    // 🔹 New field for storing full eWay Bill JSON
    ewayBill: {
      type: Object,
      schema: {
        fromGstin: String,
        fromTrdName: String,
        fromAddr1: String,
        fromAddr2: String,
        fromPlace: String,
        fromPincode: String,
        fromStateCode: Number,
        actualFromStateCode: Number,

        supplyType: String,
        subSupplyType: Number,
        transType: Number,
        vehicleType: String,
        transMode: Number,
        transDistance: Number,

        toGstin: String,
        toTrdName: String,
        toAddr1: String,
        toAddr2: String,
        toPlace: String,
        toPincode: String,
        toStateCode: Number,
        actualToStateCode: Number,

        docType: String,
        docNo: String,
        docDate: String,

        transporterName: String,
        transDocNo: String,
        transDocDate: String,
        vehicleNo: String,

        totalValue: Number,
        cgstValue: Number,
        sgstValue: Number,
        igstValue: Number,
        totInvValue: Number,
        OthValue: Number,
        TotNonAdvolVal: Number,
        mainHsnCode: String,

        itemList: {
          type: Array,
          schema: [
            {
              type: Object,
              schema: {
                itemNo: Number,
                productName: String,
                productDesc: String,
                hsnCode: String,
                quantity: Number,
                qtyUnit: String,
                taxableAmount: Number,
                sgstRate: Number,
                cgstRate: Number,
                igstRate: Number,
                cessRate: Number,
                cessNonAdvol: Number
              },
            },
          ],
        },
      },
    },
  },
  { timestamps: true }
);

const Sales = dynamoose.model("Sales", salesSchema);
module.exports = Sales;