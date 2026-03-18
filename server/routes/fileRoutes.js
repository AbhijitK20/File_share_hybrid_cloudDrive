const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { uploadFiles } = require('../controllers/uploadController');
const { getFilesByCode, downloadFile, previewFile } = require('../controllers/accessController');

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

const { optionalAuth } = require('../middleware/authMiddleware');

// Routes
router.post('/upload', optionalAuth, upload.array('files', 20), uploadFiles);
router.get('/:code', optionalAuth, getFilesByCode);
router.get('/download/:id', optionalAuth, downloadFile);
router.get('/preview/:id', optionalAuth, previewFile);

module.exports = router;
