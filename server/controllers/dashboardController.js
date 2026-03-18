const File = require('../models/File');
const path = require('path');
const fs = require('fs');

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
        mimetype: f.mimetype,
        groupCode: f.groupCode,
        visibility: f.visibility,
        createdAt: f.createdAt,
        expiresAt: f.expiresAt,
      })),
    });
  } catch (error) {
    console.error('Dashboard files error:', error);
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

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Extend file expiry.
 * PATCH /api/dashboard/files/:id/extend
 */
exports.extendExpiry = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check ownership
    if (!file.uploadedBy || file.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to modify this file' });
    }

    const { days } = req.body;
    const extendDays = Math.min(parseInt(days) || 7, 10); // Max 10 days for free

    // Extend from current expiry or now, whichever is later
    const baseDate = new Date(Math.max(file.expiresAt.getTime(), Date.now()));
    file.expiresAt = new Date(baseDate.getTime() + extendDays * 24 * 60 * 60 * 1000);
    await file.save();

    res.json({
      message: `Expiry extended by ${extendDays} day(s)`,
      expiresAt: file.expiresAt,
    });
  } catch (error) {
    console.error('Extend expiry error:', error);
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

    // Unique group codes
    const uniqueCodes = [...new Set(files.map(f => f.groupCode))];

    res.json({
      totalFiles,
      activeFiles,
      expiredFiles: totalFiles - activeFiles,
      totalSize,
      totalShares: uniqueCodes.length,
    });
  } catch (error) {
    console.error('Stats error:', error);
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
    
    if (!['public', 'private'].includes(visibility)) {
      return res.status(400).json({ message: 'Invalid visibility status' });
    }

    file.visibility = visibility;
    await file.save();

    res.json({
      message: `File visibility updated to ${visibility}`,
      visibility: file.visibility,
    });
  } catch (error) {
    console.error('Toggle visibility error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
