const fs = require('fs');
const File = require('../models/File');
const User = require('../models/User');
const { generateUniqueCode } = require('../utils/codeGenerator');
const QRCode = require('qrcode');
const path = require('path');

/**
 * Upload multiple files and generate a shared access code.
 * POST /api/files/upload
 */
exports.uploadFiles = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    // Determine user plan limits
    const isPremium = req.user?.plan === 'premium';
    const MAX_FILE_SIZE = isPremium ? 5 * 1024 * 1024 * 1024 : 100 * 1024 * 1024; // 5GB vs 100MB

    // Check sizes
    let totalSize = 0;
    for (const file of req.files) {
      totalSize += file.size;
      if (file.size > MAX_FILE_SIZE) {
        // Cleanup written files if one exceeds the limit
        for (const f of req.files) {
          fs.unlink(path.join(__dirname, '..', 'uploads', f.filename), () => {});
        }
        return res.status(413).json({ 
          message: `File ${file.originalname} exceeds the limit of ${isPremium ? '5GB' : '100MB'}. ${!isPremium ? 'Upgrade to Premium for 5GB limits.' : ''}` 
        });
      }
    }

    // Generate unique 6-digit code for this file group
    const groupCode = await generateUniqueCode();

    // Default expiry: 24 hours from now
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Save each file's metadata to DB
    const savedFiles = [];
    for (const file of req.files) {
      const newFile = new File({
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        groupCode,
        expiresAt,
        uploadedBy: req.user ? req.user._id : null,
      });
      const saved = await newFile.save();
      savedFiles.push(saved);
    }

    // Generate QR code as base64 data URI
    const accessUrl = `${process.env.CLIENT_URL}/access/${groupCode}`;
    const qrCodeDataUrl = await QRCode.toDataURL(accessUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    res.status(201).json({
      message: 'Files uploaded successfully',
      groupCode,
      accessUrl,
      qrCode: qrCodeDataUrl,
      files: savedFiles.map(f => ({
        id: f._id,
        name: f.originalName,
        size: f.size,
        mimetype: f.mimetype,
      })),
      expiresAt,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Server error during upload' });
  }
};
