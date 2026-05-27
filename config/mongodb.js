const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
  try {
    await mongoose.connect(
      "mongodb://admin:Admin%402025@93.127.167.226:27017/jassperfumes?authSource=admin&authMechanism=SCRAM-SHA-256",
      // "mongodb://admin:Admin%402025@93.127.167.226:27017/jasstesting?authSource=admin&authMechanism=SCRAM-SHA-256",
      {
        useNewUrlParser: true,
        useUnifiedTopology: true
      }
    );
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
};

module.exports = connectDB;