const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const supabase = require('./utils/supabase');
require('./utils/loadEnv');

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
}

const fileRoutes = require('./routes/fileRoutes');
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const { logger } = require('./utils/logger');
const { requestSecurityGuard } = require('./middleware/securityGuard');

const app = express();
const PORT = process.env.PORT || 5000;

// Logs directory still useful for serverless logs if allowed, but cloud logging is better
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
}));

const corsOptions = {
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestSecurityGuard);

app.use((req, res, next) => {
  logger.http(`${req.method} ${req.path}`);
  next();
});

app.use('/api/files', fileRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payment', paymentRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('Welcome to the Hybrid CloudDrive API (Supabase Storage Edition)!');
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

if (!process.env.VERCEL) {
  cron.schedule('*/10 * * * *', async () => {
  try {
    logger.info('[CRON] Running expired file cleanup...');
    const now = new Date().toISOString();
    
    // 1. Get expired files from DB
    const { data: expiredFiles, error } = await supabase
      .from('files')
      .select('id, filename, uploaded_by_id, compressed_size, size')
      .lt('expires_at', now);

    if (error) throw error;

    if (expiredFiles.length > 0) {
      let removedCount = 0;
      const removedBytesByOwner = new Map();

      // 2. Delete from Supabase Storage first; only then delete DB row.
      for (const file of expiredFiles) {
        const { error: storageError } = await supabase.storage
          .from('uploads')
          .remove([file.filename]);

        if (storageError) {
          logger.warn(`[CRON] Storage deletion failed for ${file.filename}: ${storageError.message}`);
          continue;
        }

        const { error: dbDeleteError } = await supabase
          .from('files')
          .delete()
          .eq('id', file.id);

        if (dbDeleteError) {
          logger.warn(`[CRON] DB deletion failed for file ${file.id}: ${dbDeleteError.message}`);
          continue;
        }

        const bytes = Number(file.compressed_size || file.size || 0);
        if (file.uploaded_by_id) {
          const prev = removedBytesByOwner.get(file.uploaded_by_id) || 0;
          removedBytesByOwner.set(file.uploaded_by_id, prev + bytes);
        }

        removedCount += 1;
      }

      // 3. Update storage usage for affected owners.
      for (const [ownerId, bytesToSubtract] of removedBytesByOwner.entries()) {
        const { data: owner } = await supabase
          .from('users')
          .select('id, storage_used')
          .eq('id', ownerId)
          .maybeSingle();

        if (!owner) continue;

        const nextStorage = Math.max(0, Number(owner.storage_used || 0) - Number(bytesToSubtract));
        await supabase
          .from('users')
          .update({ storage_used: nextStorage })
          .eq('id', ownerId);
      }

      logger.info(`[CRON] Cleanup complete. Removed ${removedCount} expired file(s) from Supabase storage and database.`);
    } else {
      logger.info('[CRON] No expired files found.');
    }
  } catch (error) {
    logger.error('[CRON] Cleanup error:', error);
  }
  });

  app.listen(PORT, () => {
    logger.info(`🚀 Server running on http://localhost:${PORT}`);
  });
} else {
  module.exports = app;
}
