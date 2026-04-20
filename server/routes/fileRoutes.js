const express = require('express');
const multer = require('multer');
const { uploadFiles } = require('../controllers/uploadController');
const { getFilesByCode, downloadFile, previewFile } = require('../controllers/accessController');
const { optionalAuth } = require('../middleware/authMiddleware');
const { fileValidationMiddleware } = require('../middleware/fileValidation');
const { uploadLimiter, accessLimiter, downloadLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Use Memory Storage for Supabase Cloud conversion
const storage = multer.memoryStorage();
const defaultMulterMaxBytes = process.env.VERCEL ? 4 * 1024 * 1024 : 5 * 1024 * 1024 * 1024;
const configuredMulterMaxBytes = Number(process.env.MULTER_MAX_FILE_SIZE_BYTES || defaultMulterMaxBytes);
const multerMaxFileSize = Number.isFinite(configuredMulterMaxBytes) && configuredMulterMaxBytes > 0
  ? configuredMulterMaxBytes
  : defaultMulterMaxBytes;
const maxFilesPerUpload = Number.isFinite(Number(process.env.MAX_FILES_PER_UPLOAD))
  ? Math.max(1, Number(process.env.MAX_FILES_PER_UPLOAD))
  : 20;

const upload = multer({
  storage,
  limits: {
    fileSize: multerMaxFileSize,
  },
});

// Routes
router.post('/upload', 
  optionalAuth, 
  uploadLimiter,
  upload.array('files', maxFilesPerUpload),
  fileValidationMiddleware,
  uploadFiles
);

router.get('/:code', 
  accessLimiter,
  optionalAuth, 
  getFilesByCode
);

router.get('/download/:id', 
  downloadLimiter,
  optionalAuth, 
  downloadFile
);

router.get('/preview/:id', 
  accessLimiter,
  optionalAuth, 
  previewFile
);

module.exports = router;
