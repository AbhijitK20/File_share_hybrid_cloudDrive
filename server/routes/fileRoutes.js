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

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5 GB limit
  },
});

// Routes
router.post('/upload', 
  uploadLimiter,
  optionalAuth, 
  upload.array('files', 20),
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
