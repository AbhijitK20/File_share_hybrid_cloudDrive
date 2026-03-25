const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { uploadFiles } = require('../controllers/uploadController');
const { getFilesByCode, downloadFile, previewFile } = require('../controllers/accessController');
const { optionalAuth } = require('../middleware/authMiddleware');
const { fileValidationMiddleware } = require('../middleware/fileValidation');
const { uploadLimiter, accessLimiter, downloadLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Multer storage config — save to uploads/ with unique filenames
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5 GB hard limit (validated in controller)
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
