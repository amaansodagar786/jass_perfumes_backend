// routes/s3Routes.js
const express = require("express");
const AWS = require("aws-sdk");
const router = express.Router();

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

router.post("/sales-presigned-url", async (req, res) => {
  console.log("POST /s3/sales-presigned-url called");
  console.log("Request body:", req.body);

  const { invoiceNumber, fileType } = req.body;

  if (!invoiceNumber || !fileType) {
    console.error("Missing parameters in request body");
    return res.status(400).json({ error: "invoiceNumber and fileType are required" });
  }

  // Extract file extension from fileType
  const extension = fileType.split('/')[1] || 'jpg';
  const Key = `sales/${invoiceNumber}-${Date.now()}.${extension}`;

  const params = {
    Bucket: process.env.AWS_BUCKET,
    Key,
    Expires: 300,
    ContentType: fileType,
    // ACL: "public-read" 

  };

  try {
    const uploadUrl = await s3.getSignedUrlPromise("putObject", params);
    const fileUrl = `https://${params.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${Key}`;
    console.log("Upload URL generated:", uploadUrl);
    res.json({ uploadUrl, fileUrl });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    res.status(500).json({ error: error.message });
  }
});


module.exports = router;
