const File = require('../models/File');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

function appendActivity(file, { user, action, details }) {
  if (!file.activityLogs) file.activityLogs = [];
  file.activityLogs.push({
    userId: user?._id || null,
    email: user?.email || null,
    name: user?.name || 'Anonymous',
    action,
    details: details || '',
    at: new Date(),
  });
  if (file.activityLogs.length > 200) {
    file.activityLogs = file.activityLogs.slice(-200);
  }
}

/**
 * Get all files owned by the authenticated user.
 * GET /api/dashboard/files
 */
exports.getMyFiles = async (req, res) => {
  try {
    const files = await File.find({ uploadedBy: req.user._id })
      .sort({ createdAt: -1 });

    res.json({
      count: files.length,
      files: files.map(f => ({
        id: f._id,
        name: f.originalName,
        size: f.size,
        compressedSize: f.compressedSize,
        mimetype: f.mimetype,
        groupCode: f.groupCode,
        visibility: f.visibility,
        encrypted: f.encryption?.enabled || false,
        compressed: f.isCompressed,
        accessControl: f.accessControl?.mode || 'public',
        accessControlDetails: {
          mode: f.accessControl?.mode || 'public',
          blockedUsers: (f.accessControl?.blockedUsers || []).map((b) => b.userId),
          allowedUsers: (f.accessControl?.allowedUsers || []).map((a) => ({
            userId: a.userId,
            permissions: a.permissions || ['view'],
          })),
        },
        insights: {
          sharedWithCount: (f.accessControl?.allowedUsers || []).length,
          viewedByCount: (f.accessInsights?.viewedBy || []).length,
          editedByCount: (f.accessInsights?.editedBy || []).length,
        },
        createdAt: f.createdAt,
        expiresAt: f.expiresAt,
      })),
    });
  } catch (error) {
    logger.error('Dashboard files error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Delete a file owned by the user.
 * DELETE /api/dashboard/files/:id
 */
exports.deleteFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check ownership
    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this file' });
    }

    // Delete physical file
    const filePath = path.join(__dirname, '..', 'uploads', file.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete DB record
    await File.findByIdAndDelete(file._id);

    logger.info(`[DELETE] File deleted: ${file.originalName} by ${req.user._id}`);
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    logger.error('Delete file error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Extend file expiry.
 * PATCH /api/dashboard/files/:id/extend
 */
exports.extendExpiry = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.plan !== 'premium') {
      return res.status(403).json({
        message: 'Expiry extension is available only for premium users',
      });
    }

    const file = await File.findById(req.params.id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check ownership
    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to modify this file' });
    }

    const { days } = req.body;
    const parsedDays = parseInt(days, 10);
    const extendDays = Math.min(Math.max(Number.isFinite(parsedDays) ? parsedDays : 7, 1), 30);

    const baseDate = new Date(Math.max(file.expiresAt.getTime(), Date.now()));
    file.expiresAt = new Date(baseDate.getTime() + extendDays * 24 * 60 * 60 * 1000);
    appendActivity(file, {
      user: req.user,
      action: 'expiry_extended',
      details: `Extended by ${extendDays} day(s)`,
    });
    await file.save();

    res.json({
      message: `Expiry extended by ${extendDays} day(s)`,
      expiresAt: file.expiresAt,
    });
  } catch (error) {
    logger.error('Extend expiry error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Get dashboard stats for the user.
 * GET /api/dashboard/stats
 */
exports.getStats = async (req, res) => {
  try {
    const totalFiles = await File.countDocuments({ uploadedBy: req.user._id });
    const activeFiles = await File.countDocuments({
      uploadedBy: req.user._id,
      expiresAt: { $gt: new Date() },
    });

    const files = await File.find({ uploadedBy: req.user._id });
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const totalCompressedSize = files.reduce((sum, f) => sum + (f.compressedSize || f.size), 0);
    const spaceSaved = totalSize - totalCompressedSize;
    const encryptedFiles = files.filter(f => f.encryption?.enabled).length;
    const compressedFiles = files.filter(f => f.isCompressed).length;

    const uniqueCodes = [...new Set(files.map(f => f.groupCode))];

    res.json({
      totalFiles,
      activeFiles,
      expiredFiles: totalFiles - activeFiles,
      totalSize,
      totalCompressedSize,
      spaceSaved,
      spaceSavedPercentage: totalSize > 0 ? ((spaceSaved / totalSize) * 100).toFixed(2) : 0,
      encryptedFiles,
      compressedFiles,
      totalShares: uniqueCodes.length,
    });
  } catch (error) {
    logger.error('Stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Toggle file visibility between public and private.
 * PATCH /api/dashboard/files/:id/visibility
 */
exports.toggleVisibility = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check ownership
    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to modify this file' });
    }

    const { visibility } = req.body;

    if (!['public', 'private', 'shared'].includes(visibility)) {
      return res.status(400).json({ message: 'Invalid visibility status' });
    }

    file.visibility = visibility;
    appendActivity(file, {
      user: req.user,
      action: 'visibility_changed',
      details: `Visibility set to ${visibility}`,
    });
    await file.save();

    res.json({
      message: `File visibility updated to ${visibility}`,
      visibility: file.visibility,
    });
  } catch (error) {
    logger.error('Toggle visibility error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Update file access control settings
 * PATCH /api/dashboard/files/:id/access
 * 
 * Body: { mode: 'public' | 'allowlist' | 'blocklist' }
 */
exports.updateAccessControl = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check ownership
    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to modify this file' });
    }

    const { mode } = req.body;

    if (!['public', 'allowlist', 'blocklist'].includes(mode)) {
      return res.status(400).json({ message: 'Invalid access control mode' });
    }

    if (!file.accessControl) {
      file.accessControl = {};
    }

    file.accessControl.mode = mode;
    await file.save();

    logger.info(`[ACCESS CONTROL] File ${file._id} access mode changed to ${mode}`);

    res.json({
      message: `Access control updated to ${mode}`,
      accessControl: file.accessControl,
    });
  } catch (error) {
    logger.error('Update access control error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Get detailed file permissions
 * GET /api/dashboard/files/:id/permissions
 */
exports.getFilePermissions = async (req, res) => {
  try {
    const file = await File.findById(req.params.id).populate('accessControl.allowedUsers.userId', 'name email');

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check ownership
    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to view this file permissions' });
    }

    res.json({
      fileId: file._id,
      fileName: file.originalName,
      visibility: file.visibility,
      accessControl: {
        mode: file.accessControl?.mode || 'public',
        blockedUsers: file.accessControl?.blockedUsers || [],
        allowedUsers: (file.accessControl?.allowedUsers || []).map(au => ({
          userId: au.userId?._id,
          email: au.userId?.email,
          name: au.userId?.name,
          permissions: au.permissions,
          grantedAt: au.grantedAt,
        })),
      },
    });
  } catch (error) {
    logger.error('Get permissions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Add a user to blocklist
 * POST /api/dashboard/files/:id/blocklist
 * Body: { userId: string }
 */
exports.addBlockedUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const file = await File.findById(id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check ownership
    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already blocked
    if (file.accessControl?.blockedUsers?.some(b => b.userId.toString() === userId)) {
      return res.status(400).json({ message: 'User already blocked' });
    }

    if (!file.accessControl) {
      file.accessControl = { mode: 'blocklist' };
    }

    if (!file.accessControl.blockedUsers) {
      file.accessControl.blockedUsers = [];
    }

    file.accessControl.blockedUsers.push({ userId, blockedAt: new Date() });
    await file.save();

    logger.info(`[BLOCKLIST] User ${userId} blocked from file ${id}`);

    res.json({
      message: 'User added to blocklist',
      blockedUsers: file.accessControl.blockedUsers,
    });
  } catch (error) {
    logger.error('Add blocked user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Remove a user from blocklist
 * DELETE /api/dashboard/files/:id/blocklist/:userId
 */
exports.removeBlockedUser = async (req, res) => {
  try {
    const { id, userId } = req.params;

    const file = await File.findById(id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check ownership
    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (!file.accessControl?.blockedUsers) {
      return res.status(404).json({ message: 'User not in blocklist' });
    }

    file.accessControl.blockedUsers = file.accessControl.blockedUsers.filter(
      b => b.userId.toString() !== userId
    );

    await file.save();

    logger.info(`[BLOCKLIST] User ${userId} removed from blocklist of file ${id}`);

    res.json({
      message: 'User removed from blocklist',
      blockedUsers: file.accessControl.blockedUsers,
    });
  } catch (error) {
    logger.error('Remove blocked user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Add a user to allowlist with permissions
 * POST /api/dashboard/files/:id/allowlist
 * Body: { userId: string, permissions: ['view'] | ['view', 'edit'] }
 */
exports.addAllowedUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, email, permissions = ['view'] } = req.body;

    if (!userId && !email) {
      return res.status(400).json({ message: 'userId or email is required' });
    }

    const file = await File.findById(id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check ownership
    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Verify user exists
    const user = userId
      ? await User.findById(userId)
      : await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const targetUserId = user._id.toString();

    // Validate permissions
    const validPermissions = ['view', 'edit', 'delete'];
    if (!Array.isArray(permissions) || !permissions.every(p => validPermissions.includes(p))) {
      return res.status(400).json({ message: 'Invalid permissions' });
    }

    // Check if already allowed
    if (file.accessControl?.allowedUsers?.some(a => a.userId.toString() === targetUserId)) {
      return res.status(400).json({ message: 'User already in allowlist' });
    }

    if (!file.accessControl) {
      file.accessControl = { mode: 'allowlist' };
    }

    if (!file.accessControl.allowedUsers) {
      file.accessControl.allowedUsers = [];
    }

    file.accessControl.allowedUsers.push({ userId: targetUserId, permissions, grantedAt: new Date() });
    appendActivity(file, {
      user: req.user,
      action: 'share_granted',
      details: `Granted ${permissions.join(',')} to ${user.email}`,
    });
    await file.save();

    logger.info(`[ALLOWLIST] User ${targetUserId} added to file ${id} with permissions: ${permissions.join(',')}`);

    res.json({
      message: 'User added to allowlist',
      user: { id: user._id, email: user.email, name: user.name },
      allowedUsers: file.accessControl.allowedUsers,
    });
  } catch (error) {
    logger.error('Add allowed user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Update allowlist permissions by user id
 * PATCH /api/dashboard/files/:id/allowlist/:userId
 * Body: { permissions: ['view'] | ['view', 'edit'] }
 */
exports.updateAllowedUserPermissions = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions) || permissions.length === 0) {
      return res.status(400).json({ message: 'permissions array is required' });
    }

    const validPermissions = ['view', 'edit', 'delete'];
    if (!permissions.every((p) => validPermissions.includes(p))) {
      return res.status(400).json({ message: 'Invalid permissions' });
    }

    const file = await File.findById(id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const target = file.accessControl?.allowedUsers?.find((a) => a.userId.toString() === userId);
    if (!target) {
      return res.status(404).json({ message: 'User not in allowlist' });
    }

    target.permissions = permissions;
    appendActivity(file, {
      user: req.user,
      action: 'permission_updated',
      details: `Updated permissions for ${userId} to ${permissions.join(',')}`,
    });
    await file.save();

    return res.json({
      message: 'Permissions updated',
      userId,
      permissions,
    });
  } catch (error) {
    logger.error('Update allowed user permissions error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Remove a user from allowlist
 * DELETE /api/dashboard/files/:id/allowlist/:userId
 */
exports.removeAllowedUser = async (req, res) => {
  try {
    const { id, userId } = req.params;

    const file = await File.findById(id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check ownership
    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (!file.accessControl?.allowedUsers) {
      return res.status(404).json({ message: 'User not in allowlist' });
    }

    file.accessControl.allowedUsers = file.accessControl.allowedUsers.filter(
      a => a.userId.toString() !== userId
    );
    appendActivity(file, {
      user: req.user,
      action: 'share_removed',
      details: `Removed access for ${userId}`,
    });

    await file.save();

    logger.info(`[ALLOWLIST] User ${userId} removed from allowlist of file ${id}`);

    res.json({
      message: 'User removed from allowlist',
      allowedUsers: file.accessControl.allowedUsers,
    });
  } catch (error) {
    logger.error('Remove allowed user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Get file sharing analytics and activity timeline
 * GET /api/dashboard/files/:id/activity
 */
exports.getFileActivity = async (req, res) => {
  try {
    const file = await File.findById(req.params.id).populate('accessControl.allowedUsers.userId', 'name email');

    if (!file) return res.status(404).json({ message: 'File not found' });
    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    return res.json({
      fileId: file._id,
      fileName: file.originalName,
      sharedWith: (file.accessControl?.allowedUsers || []).map((entry) => ({
        userId: entry.userId?._id || entry.userId,
        name: entry.userId?.name || null,
        email: entry.userId?.email || null,
        permissions: entry.permissions || ['view'],
        grantedAt: entry.grantedAt,
      })),
      viewedBy: file.accessInsights?.viewedBy || [],
      editedBy: file.accessInsights?.editedBy || [],
      activityLogs: (file.activityLogs || []).sort((a, b) => new Date(b.at) - new Date(a.at)),
      summary: {
        sharedWithCount: (file.accessControl?.allowedUsers || []).length,
        viewedByCount: (file.accessInsights?.viewedBy || []).length,
        editedByCount: (file.accessInsights?.editedBy || []).length,
      },
    });
  } catch (error) {
    logger.error('Get file activity error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
