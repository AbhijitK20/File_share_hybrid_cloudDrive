const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { checkFilePermission } = require('../middleware/accessControl');
const {
  getMyFiles,
  deleteFile,
  extendExpiry,
  getStats,
  toggleVisibility,
  updateAccessControl,
  addBlockedUser,
  removeBlockedUser,
  addAllowedUser,
  updateAllowedUserPermissions,
  removeAllowedUser,
  getFileActivity,
  getFilePermissions,
} = require('../controllers/dashboardController');

const router = express.Router();

// All dashboard routes are protected
router.use(protect);

// File management
router.get('/files', getMyFiles);
router.delete('/files/:id', deleteFile);
router.patch('/files/:id/extend', extendExpiry);
router.patch('/files/:id/visibility', toggleVisibility);
router.get('/stats', getStats);

// Access control management (NEW)
router.patch('/files/:id/access', updateAccessControl);
router.get('/files/:id/permissions', getFilePermissions);
router.get('/files/:id/activity', getFileActivity);
router.post('/files/:id/blocklist', addBlockedUser);
router.delete('/files/:id/blocklist/:userId', removeBlockedUser);
router.post('/files/:id/allowlist', addAllowedUser);
router.patch('/files/:id/allowlist/:userId', updateAllowedUserPermissions);
router.delete('/files/:id/allowlist/:userId', removeAllowedUser);

module.exports = router;
