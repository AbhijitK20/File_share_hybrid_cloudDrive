const File = require('../models/File');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');
const { logFileAccess, logger } = require('../utils/logger');
const encryptionUtils = require('../utils/encryption');
const compressionUtils = require('../utils/compression');

function markFileInsight(file, action, user) {
  if (!user) return;
  if (!file.accessInsights) file.accessInsights = { viewedBy: [], editedBy: [] };
  const bucketName = action === 'edit' ? 'editedBy' : 'viewedBy';
  const bucket = file.accessInsights[bucketName] || [];
  const idx = bucket.findIndex((e) => e.userId?.toString() === user._id.toString());
  if (idx >= 0) {
    bucket[idx].count = (bucket[idx].count || 0) + 1;
    bucket[idx].lastAt = new Date();
  } else {
    bucket.push({
      userId: user._id,
      email: user.email,
      name: user.name,
      count: 1,
      lastAt: new Date(),
    });
  }
  file.accessInsights[bucketName] = bucket;
  if (!file.activityLogs) file.activityLogs = [];
  file.activityLogs.push({
    userId: user._id,
    email: user.email,
    name: user.name,
    action: action === 'edit' ? 'permission_updated' : action,
    details: action === 'preview' ? 'Previewed file' : 'Downloaded file',
    at: new Date(),
  });
  if (file.activityLogs.length > 200) {
    file.activityLogs = file.activityLogs.slice(-200);
  }
}

/**
 * Validate MongoDB ObjectId format
 */
function isValidObjectId(id) {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Sanitize filename for Content-Disposition header
 * Prevents header injection attacks
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[\r\n\0]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .slice(0, 255);
}

/**
 * Get all files associated with a group code.
 * GET /api/files/:code
 * 
 * Now includes encryption/compression metadata
 */
exports.getFilesByCode = async (req, res) => {
  try {
    const { code } = req.params;

    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({
        message: 'Invalid access code. It must be a 6-digit number.',
      });
    }

    const query = {
      groupCode: code,
      expiresAt: { $gt: new Date() },
    };

    const files = await File.find(query).populate('uploadedBy');

    const filteredFiles = files.filter((file) => {
      if (req.user && file.uploadedBy && file.uploadedBy._id.toString() === req.user._id.toString()) {
        return true;
      }

      const mode = file.accessControl?.mode || 'public';
      const userId = req.user?._id?.toString();

      if (!req.user) {
        return mode === 'public' && file.visibility === 'public';
      }

      if (mode === 'allowlist') {
        return file.accessControl?.allowedUsers?.some((a) => a.userId?.toString() === userId);
      }

      if (mode === 'blocklist') {
        return !file.accessControl?.blockedUsers?.some((b) => b.userId?.toString() === userId);
      }

      // public mode (default): respect explicit visibility + per-user blocks
      const blocked = file.accessControl?.blockedUsers?.some((b) => b.userId?.toString() === userId);
      return file.visibility === 'public' && !blocked;
    });

    logFileAccess(req.user?._id, code, 'LIST', req.ip, filteredFiles.length > 0);

    if (filteredFiles.length === 0) {
      return res.status(404).json({
        message: 'No files found for this code, or the files have expired.',
      });
    }

    res.json({
      groupCode: code,
      files: filteredFiles.map(f => ({
        id: f._id,
        name: f.originalName,
        size: f.size,
        compressedSize: f.compressedSize,
        mimetype: f.mimetype,
        encrypted: f.encryption?.enabled || false,
        compressed: f.isCompressed,
        createdAt: f.createdAt,
        expiresAt: f.expiresAt,
      })),
    });
  } catch (error) {
    logger.error('Access error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Download a specific file by its ID with decryption & decompression
 * GET /api/files/download/:id
 * 
 * Features:
 * - Decrypt if encrypted
 * - Decompress if compressed
 * - Access control checking (new)
 * - Performance optimized
 */
exports.downloadFile = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid file ID' });
    }

    const file = await File.findById(id).populate('uploadedBy');

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if expired
    if (new Date() > file.expiresAt) {
      logFileAccess(req.user?._id, id, 'DOWNLOAD', req.ip, false);
      return res.status(410).json({ message: 'This file has expired' });
    }

    // Private visibility rule:
    // - owner always allowed
    // - explicitly allowlisted users with "view" are allowed
    // - everyone else denied
    if (file.visibility === 'private') {
      const userId = req.user?._id?.toString();
      const isOwner = !!(req.user && file.uploadedBy && file.uploadedBy._id.toString() === userId);
      const allowEntry = file.accessControl?.allowedUsers?.find(
        (allowed) => allowed.userId?.toString() === userId
      );
      const allowlistedWithView = !!(
        allowEntry &&
        Array.isArray(allowEntry.permissions) &&
        allowEntry.permissions.includes('view')
      );

      if (!isOwner && !allowlistedWithView) {
        logFileAccess(req.user?._id, id, 'DOWNLOAD', req.ip, false);
        return res.status(403).json({ message: 'This file is private' });
      }
    }

    // Check new access control (blocklist/allowlist)
    if (file.accessControl?.mode) {
      const userId = req.user?._id.toString();
      const mode = file.accessControl.mode;

      if (mode === 'blocklist') {
        const isBlocked = file.accessControl.blockedUsers?.some(
          (blocked) => blocked.userId?.toString() === userId
        );
        if (isBlocked) {
          logFileAccess(req.user?._id, id, 'DOWNLOAD', req.ip, false);
          return res.status(403).json({ message: 'You are blocked from accessing this file' });
        }
      } else if (mode === 'allowlist') {
        const allowedUser = file.accessControl.allowedUsers?.find(
          (allowed) => allowed.userId?.toString() === userId
        );
        const isOwner = file.uploadedBy && file.uploadedBy._id.toString() === userId;
        const canView = allowedUser && Array.isArray(allowedUser.permissions) && allowedUser.permissions.includes('view');
        if (!isOwner && !canView) {
          logFileAccess(req.user?._id, id, 'DOWNLOAD', req.ip, false);
          return res.status(403).json({ message: 'You do not have access to this file' });
        }
      }
    }

    const filePath = path.join(__dirname, '..', 'uploads', file.filename);

    if (!fs.existsSync(filePath)) {
      logFileAccess(req.user?._id, id, 'DOWNLOAD', req.ip, false);
      return res.status(404).json({ message: 'File not found on server' });
    }

    try {
      // Read file from disk
      let fileData = fs.readFileSync(filePath);
      logger.debug(`[DOWNLOAD] Read file from disk: ${compressionUtils.formatBytes(fileData.length)}`);

      // Step 1: Decrypt if encrypted
      if (file.encryption?.enabled) {
        try {
          // Get user master key for decryption
          const user = file.uploadedBy;
          if (!user) {
            throw new Error('Cannot decrypt: file uploader not found');
          }

          const encryptedMasterKey = await User.findById(user._id).select('+masterKey');
          if (!encryptedMasterKey?.masterKey) {
            throw new Error('Cannot decrypt: master key not found');
          }

          const masterKey = encryptionUtils.decryptMasterKeyFromStorage(encryptedMasterKey.masterKey);
          const fileKeyData = encryptionUtils.generateFileKey(masterKey, file.encryption.fileKeyNonce);

          fileData = encryptionUtils.decryptFile(
            fileData,
            fileKeyData.fileKey,
            file.encryption.iv,
            file.encryption.authTag
          );

          logger.info(`[DOWNLOAD] File decrypted: ${file.originalName}`);
        } catch (decryptError) {
          logger.error(`Decryption failed for ${file.originalName}:`, decryptError.message);
          logFileAccess(req.user?._id, id, 'DOWNLOAD', req.ip, false);
          return res.status(500).json({
            message: 'File decryption failed',
            error: 'The file appears to be corrupted or tampered with',
          });
        }
      }

      // Step 2: Decompress if compressed
      if (file.isCompressed) {
        try {
          fileData = await compressionUtils.decompressGZIP(fileData);
          logger.info(`[DOWNLOAD] File decompressed: ${file.originalName}`);
        } catch (decompressError) {
          logger.error(`Decompression failed for ${file.originalName}:`, decompressError.message);
          logFileAccess(req.user?._id, id, 'DOWNLOAD', req.ip, false);
          return res.status(500).json({
            message: 'File decompression failed',
            error: 'The file appears to be corrupted',
          });
        }
      }

      // Audit log success
      logFileAccess(req.user?._id, id, 'DOWNLOAD', req.ip, true);
      if (req.user) {
        markFileInsight(file, 'download', req.user);
        await file.save();
      }

      // Sanitize filename
      const sanitizedName = sanitizeFilename(file.originalName);

      // Set security headers
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sanitizedName)}"`);
      res.setHeader('Content-Type', file.mimetype);
      res.setHeader('Content-Length', fileData.length);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      // Send file
      res.send(fileData);
    } catch (error) {
      logger.error(`Error processing download for ${file.originalName}:`, error);
      logFileAccess(req.user?._id, id, 'DOWNLOAD', req.ip, false);
      res.status(500).json({ message: 'Error processing file' });
    }
  } catch (error) {
    logger.error('Download error:', error);
    res.status(500).json({ message: 'Server error during download' });
  }
};

/**
 * Preview a specific file by its ID with decryption & decompression
 * GET /api/files/preview/:id
 * 
 * Same as download but inline (for browser viewing)
 */
exports.previewFile = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid file ID' });
    }

    const file = await File.findById(id).populate('uploadedBy');

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if expired
    if (new Date() > file.expiresAt) {
      logFileAccess(req.user?._id, id, 'PREVIEW', req.ip, false);
      return res.status(410).json({ message: 'This file has expired' });
    }

    // Private visibility rule:
    // - owner always allowed
    // - explicitly allowlisted users with "view" are allowed
    // - everyone else denied
    if (file.visibility === 'private') {
      const userId = req.user?._id?.toString();
      const isOwner = !!(req.user && file.uploadedBy && file.uploadedBy._id.toString() === userId);
      const allowEntry = file.accessControl?.allowedUsers?.find(
        (allowed) => allowed.userId?.toString() === userId
      );
      const allowlistedWithView = !!(
        allowEntry &&
        Array.isArray(allowEntry.permissions) &&
        allowEntry.permissions.includes('view')
      );

      if (!isOwner && !allowlistedWithView) {
        logFileAccess(req.user?._id, id, 'PREVIEW', req.ip, false);
        return res.status(403).json({ message: 'This file is private' });
      }
    }

    // Check access control
    if (file.accessControl?.mode) {
      const userId = req.user?._id.toString();
      const mode = file.accessControl.mode;

      if (mode === 'blocklist') {
        const isBlocked = file.accessControl.blockedUsers?.some(
          (blocked) => blocked.userId?.toString() === userId
        );
        if (isBlocked) {
          logFileAccess(req.user?._id, id, 'PREVIEW', req.ip, false);
          return res.status(403).json({ message: 'You are blocked from accessing this file' });
        }
      } else if (mode === 'allowlist') {
        const allowedUser = file.accessControl.allowedUsers?.find(
          (allowed) => allowed.userId?.toString() === userId
        );
        const isOwner = file.uploadedBy && file.uploadedBy._id.toString() === userId;
        const canView = allowedUser && Array.isArray(allowedUser.permissions) && allowedUser.permissions.includes('view');
        if (!isOwner && !canView) {
          logFileAccess(req.user?._id, id, 'PREVIEW', req.ip, false);
          return res.status(403).json({ message: 'You do not have access to this file' });
        }
      }
    }

    const filePath = path.join(__dirname, '..', 'uploads', file.filename);

    if (!fs.existsSync(filePath)) {
      logFileAccess(req.user?._id, id, 'PREVIEW', req.ip, false);
      return res.status(404).json({ message: 'File not found on server' });
    }

    try {
      // Read file from disk
      let fileData = fs.readFileSync(filePath);

      // Decrypt if needed
      if (file.encryption?.enabled) {
        try {
          const user = file.uploadedBy;
          if (!user) {
            throw new Error('Cannot decrypt: file uploader not found');
          }

          const encryptedMasterKey = await User.findById(user._id).select('+masterKey');
          if (!encryptedMasterKey?.masterKey) {
            throw new Error('Cannot decrypt: master key not found');
          }

          const masterKey = encryptionUtils.decryptMasterKeyFromStorage(encryptedMasterKey.masterKey);
          const fileKeyData = encryptionUtils.generateFileKey(masterKey, file.encryption.fileKeyNonce);

          fileData = encryptionUtils.decryptFile(
            fileData,
            fileKeyData.fileKey,
            file.encryption.iv,
            file.encryption.authTag
          );

          logger.info(`[PREVIEW] File decrypted: ${file.originalName}`);
        } catch (decryptError) {
          logger.error(`Decryption failed during preview:`, decryptError.message);
          logFileAccess(req.user?._id, id, 'PREVIEW', req.ip, false);
          return res.status(500).json({ message: 'File decryption failed' });
        }
      }

      // Decompress if needed
      if (file.isCompressed) {
        try {
          fileData = await compressionUtils.decompressGZIP(fileData);
          logger.info(`[PREVIEW] File decompressed: ${file.originalName}`);
        } catch (decompressError) {
          logger.error(`Decompression failed during preview:`, decompressError.message);
          logFileAccess(req.user?._id, id, 'PREVIEW', req.ip, false);
          return res.status(500).json({ message: 'File decompression failed' });
        }
      }

      // Audit log
      logFileAccess(req.user?._id, id, 'PREVIEW', req.ip, true);
      if (req.user) {
        markFileInsight(file, 'preview', req.user);
        await file.save();
      }

      // Sanitize filename
      const sanitizedName = sanitizeFilename(file.originalName);

      // Set headers for inline preview
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(sanitizedName)}"`);
      res.setHeader('Content-Type', file.mimetype);
      res.setHeader('Content-Length', fileData.length);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      // Send file
      res.send(fileData);
    } catch (error) {
      logger.error(`Error processing preview:`, error);
      logFileAccess(req.user?._id, id, 'PREVIEW', req.ip, false);
      res.status(500).json({ message: 'Error processing file' });
    }
  } catch (error) {
    logger.error('Preview error:', error);
    res.status(500).json({ message: 'Server error during preview' });
  }
};
