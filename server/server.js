const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
require('dotenv').config();

const fileRoutes = require('./routes/fileRoutes');
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const File = require('./models/File');

const app = express();
const PORT = process.env.PORT || 5000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/files', fileRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payment', paymentRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cron job: clean up expired files every hour
cron.schedule('0 * * * *', async () => {
  try {
    console.log('[CRON] Running expired file cleanup...');
    const expiredFiles = await File.find({ expiresAt: { $lt: new Date() } });

    for (const file of expiredFiles) {
      // Delete physical file
      const filePath = path.join(uploadsDir, file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[CRON] Deleted file: ${file.originalName}`);
      }
      // Delete DB record
      await File.findByIdAndDelete(file._id);
    }

    console.log(`[CRON] Cleanup complete. Removed ${expiredFiles.length} expired file(s).`);
  } catch (error) {
    console.error('[CRON] Cleanup error:', error);
  }
});

// Connect to MongoDB and start server
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });
