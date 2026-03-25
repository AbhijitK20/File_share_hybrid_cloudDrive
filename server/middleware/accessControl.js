const { logger } = require('../utils/logger');
const File = require('../models/File');
const User = require('../models/User');

/**
 * Middleware to check if user has access to file based on access control settings
 * Supports blocklist and allowlist modes
 */
exports.checkFileAccess = async (req, res, next) => {
  try {
    const { fileId } = req.params;
    const userId = req.user?.id || req.ip;

    const file = await File.findById(fileId).populate('uploadedBy');

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // If no access control defined, use legacy visibility
    if (!file.accessControl || !file.accessControl.mode) {
      // Legacy behavior
      if (file.visibility === 'public') {
        return next();
      }

      if (file.visibility === 'private') {
        if (file.uploadedBy && file.uploadedBy._id.toString() === userId) {
          return next();
        }
        return res.status(403).json({ message: 'You do not have access to this file' });
      }

      if (file.visibility === 'shared') {
        if (file.allowedUsers && file.allowedUsers.includes(userId)) {
          return next();
        }
        return res.status(403).json({ message: 'You do not have access to this file' });
      }
    }

    // New access control logic
    const { mode, blockedUsers, allowedUsers } = file.accessControl;

    // File owner always has access
    if (file.uploadedBy && file.uploadedBy._id.toString() === userId) {
      return next();
    }

    // PUBLIC MODE - everyone has access unless blocked
    if (mode === 'public') {
      const isBlocked = blockedUsers.some(
        (blocked) => blocked.userId.toString() === userId
      );

      if (isBlocked) {
        logger.warn(`[ACCESS DENIED] User ${userId} is blocked from file ${fileId}`);
        return res.status(403).json({ message: 'You have been blocked from accessing this file' });
      }

      return next();
    }

    // ALLOWLIST MODE - only allowed users have access
    if (mode === 'allowlist') {
      const isAllowed = allowedUsers.some(
        (allowed) => allowed.userId.toString() === userId
      );

      if (!isAllowed) {
        logger.warn(`[ACCESS DENIED] User ${userId} not in allowlist for file ${fileId}`);
        return res.status(403).json({ message: 'You do not have access to this file' });
      }

      return next();
    }

    // BLOCKLIST MODE - everyone has access except blocked users
    if (mode === 'blocklist') {
      const isBlocked = blockedUsers.some(
        (blocked) => blocked.userId.toString() === userId
      );

      if (isBlocked) {
        logger.warn(`[ACCESS DENIED] User ${userId} is blocked from file ${fileId}`);
        return res.status(403).json({ message: 'You have been blocked from accessing this file' });
      }

      return next();
    }

    // Fallback - deny access
    return res.status(403).json({ message: 'You do not have access to this file' });
  } catch (error) {
    logger.error('Error in checkFileAccess middleware:', error);
    res.status(500).json({ message: 'Error checking file access' });
  }
};

/**
 * Middleware to check if user has specific permission on a file
 * Usage: checkFilePermission(['view', 'edit'])
 */
exports.checkFilePermission = (requiredPermissions = []) => {
  return async (req, res, next) => {
    try {
      const { fileId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const file = await File.findById(fileId).populate('uploadedBy');

      if (!file) {
        return res.status(404).json({ message: 'File not found' });
      }

      // File owner has all permissions
      if (file.uploadedBy && file.uploadedBy._id.toString() === userId) {
        req.userPermissions = ['view', 'edit', 'delete'];
        return next();
      }

      // Check allowlist for permissions
      if (file.accessControl && file.accessControl.mode === 'allowlist') {
        const allowedUser = file.accessControl.allowedUsers.find(
          (allowed) => allowed.userId.toString() === userId
        );

        if (!allowedUser) {
          return res.status(403).json({ message: 'You do not have access to this file' });
        }

        req.userPermissions = allowedUser.permissions;

        // Check if user has required permissions
        const hasPermission = requiredPermissions.every((perm) =>
          allowedUser.permissions.includes(perm)
        );

        if (!hasPermission) {
          return res.status(403).json({
            message: `You don't have permission to perform this action. Required: ${requiredPermissions.join(', ')}`,
          });
        }

        return next();
      }

      // Default to view permission for public files
      req.userPermissions = ['view'];

      const hasPermission = requiredPermissions.every((perm) =>
        req.userPermissions.includes(perm)
      );

      if (!hasPermission) {
        return res.status(403).json({
          message: `You don't have permission to perform this action`,
        });
      }

      return next();
    } catch (error) {
      logger.error('Error in checkFilePermission middleware:', error);
      res.status(500).json({ message: 'Error checking file permission' });
    }
  };
};

