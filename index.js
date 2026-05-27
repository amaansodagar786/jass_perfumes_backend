const express = require('express');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();

// MongoDB Connection
const connectDB = require('./config/mongodb');
connectDB();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Middlewares
app.use(cors());
app.use(express.json());

// ✅ SERVE PUBLIC UPLOADS FOLDER STATICALLY
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

const cron = require("node-cron");
const Customer = require("./models/customer");

// Routes
const inventoryRoutes = require('./routes/inventoryRoutes');
const ProductsRoutes = require('./routes/products');
const InvoiceRoutes = require("./routes/invoiceRoutes");
const adminRoutes = require('./routes/admin');
const customerRoutes = require("./routes/customerRoutes");
const authRoutes = require("./routes/authRoutes");
const ReportRoutes = require("./routes/reports");
const promoCodesRoutes = require('./routes/promoCodes');
const whatsappRoutes = require("./routes/whatsapp/whatsappRoutes");
const whatsappTemplatesRoutes = require("./routes/whatsapp/whatsappTemplates");
const whatsappTemplateSend = require("./routes/whatsapp/whatsappTemplateSend");

app.use('/customer', customerRoutes);
app.use('/auth', authRoutes);
app.use('/products', ProductsRoutes);
app.use("/invoices", InvoiceRoutes);
app.use('/admin', adminRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/report', ReportRoutes);
app.use('/promoCodes', promoCodesRoutes);
app.use("/whatsapp", whatsappRoutes);
app.use("/whatsapp/templates", whatsappTemplatesRoutes);
app.use("/whatsapp/send", whatsappTemplateSend);

cron.schedule("0 0 1 1 *", async () => {
  try {
    await Customer.updateMany({}, { $set: { loyaltyCoins: 0 } });
    console.log("✅ Yearly reset: Loyalty coins reset for all customers (1 Jan)");
  } catch (error) {
    console.error("❌ Error resetting loyalty coins:", error);
  }
});

// Basic Route
app.get('/', (req, res) => {
  res.send('New World from Jass Inventory Backend new LIVE UPDATED!');
});

// ✅ CREATE HTTP SERVER WITH SOCKET.IO
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:5173", "https://jass.techorses.com"],
    credentials: true
  }
});

// ✅ MAKE io AVAILABLE IN ROUTES
app.set('io', io);

// ✅ SOCKET CONNECTION
io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// Server
const PORT = process.env.PORT || 3037;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`🔌 Socket.io enabled for real-time messages`);
});