const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const {
  getMyFiles,
  deleteFile,
  extendExpiry,
  getStats,
  toggleVisibility,
} = require('../controllers/dashboardController');

const router = express.Router();

// All dashboard routes are protected
router.use(protect);

router.get('/files', getMyFiles);
router.delete('/files/:id', deleteFile);
router.patch('/files/:id/extend', extendExpiry);
router.patch('/files/:id/visibility', toggleVisibility);
router.get('/stats', getStats);

module.exports = router;
