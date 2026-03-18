const File = require('../models/File');
const path = require('path');
const fs = require('fs');

/**
 * Get all files associated with a group code.
 * GET /api/files/:code
 */
exports.getFilesByCode = async (req, res) => {
  try {
    const { code } = req.params;

    const query = {
      groupCode: code,
      expiresAt: { $gt: new Date() }, // Only non-expired files
    };

    // Enforce visibility: public files OR files owned by the current user
    if (req.user) {
      query.$or = [
        { visibility: 'public' },
        { uploadedBy: req.user._id },
      ];
    } else {
      query.visibility = 'public';
    }

    const files = await File.find(query);

    if (files.length === 0) {
      return res.status(404).json({
        message: 'No files found for this code, or the files have expired.',
      });
    }

    res.json({
      groupCode: code,
      files: files.map(f => ({
        id: f._id,
        name: f.originalName,
        size: f.size,
        mimetype: f.mimetype,
        createdAt: f.createdAt,
        expiresAt: f.expiresAt,
      })),
    });
  } catch (error) {
    console.error('Access error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Download a specific file by its ID.
 * GET /api/files/download/:id
 */
exports.downloadFile = async (req, res) => {
  try {
    const { id } = req.params;

    const file = await File.findById(id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if expired
    if (new Date() > file.expiresAt) {
      return res.status(410).json({ message: 'This file has expired' });
    }

    // Check visibility permissions
    if (file.visibility === 'private') {
      if (!req.user || req.user._id.toString() !== file.uploadedBy?.toString()) {
        return res.status(403).json({ message: 'This file is private and you do not have permission to access it.' });
      }
    }

    const filePath = path.join(__dirname, '..', 'uploads', file.filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Length', file.size);

    // Stream the file
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ message: 'Server error during download' });
  }
};

/**
 * Preview a specific file by its ID (Inline streaming).
 * GET /api/files/preview/:id
 */
exports.previewFile = async (req, res) => {
  try {
    const { id } = req.params;

    const file = await File.findById(id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if expired
    if (new Date() > file.expiresAt) {
      return res.status(410).json({ message: 'This file has expired' });
    }

    // Check visibility permissions
    if (file.visibility === 'private') {
      if (!req.user || req.user._id.toString() !== file.uploadedBy?.toString()) {
        return res.status(403).json({ message: 'This file is private and you do not have permission to access it.' });
      }
    }

    const filePath = path.join(__dirname, '..', 'uploads', file.filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    // Set headers for inline preview instead of attachment
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Length', file.size);

    // Stream the file
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ message: 'Server error during preview' });
  }
};
