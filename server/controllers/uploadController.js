const fs = require('fs');
const File = require('../models/File');
const User = require('../models/User');
const { generateUniqueCode } = require('../utils/codeGenerator');
const { logFileUpload, logger } = require('../utils/logger');
const QRCode = require('qrcode');
const path = require('path');
const encryptionUtils = require('../utils/encryption');
const compressionUtils = require('../utils/compression');

/**
 * Upload multiple files with encryption and compression.
 * POST /api/files/upload
 * 
 * Features:
 * - File compression (GZIP)
 * - File encryption (AES-256-GCM)
 * - Rate limiting (uploadLimiter middleware)
 * - File validation (fileValidationMiddleware)
 * - Audit logging
 * 
 * Request body:
 * {
 *   files: MultipartFile[],
 *   visibility: 'public' | 'private' | 'shared' (default: 'private'),
 *   enableEncryption: boolean (default: true),
 *   enableCompression: boolean (default: true),
 *   accessControl: { mode: 'public' | 'allowlist' | 'blocklist' }
 * }
 */
exports.uploadFiles = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    // Get user and plan limits
    const user = req.user ? await User.findById(req.user._id) : null;
    const isPremium = user?.plan === 'premium';
    const MAX_FILE_SIZE = isPremium ? 5 * 1024 * 1024 * 1024 : 100 * 1024 * 1024; // 5GB vs 100MB
    const MAX_TOTAL_SIZE = isPremium ? 50 * 1024 * 1024 * 1024 : 500 * 1024 * 1024;

    // Get encryption settings from request or user preference
    const enableEncryption = req.body.enableEncryption !== 'false' && user?.encryptionEnabled !== false;
    const enableCompression = req.body.enableCompression !== 'false';

    // Check individual file sizes
    let totalSize = 0;
    for (const file of req.files) {
      totalSize += file.size;

      if (file.size > MAX_FILE_SIZE) {
        // Cleanup uploaded files
        for (const f of req.files) {
          const filePath = path.join(__dirname, '..', 'uploads', f.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }

        logFileUpload(
          req.user?._id,
          req.files,
          req.ip,
          req.get('user-agent')
        );

        return res.status(413).json({
          message: `File ${file.originalname} exceeds the limit of ${isPremium ? '5GB' : '100MB'}. ${!isPremium ? 'Upgrade to Premium for 5GB limits.' : ''}`,
        });
      }
    }

    // Check total size
    if (totalSize > MAX_TOTAL_SIZE) {
      // Cleanup
      for (const f of req.files) {
        const filePath = path.join(__dirname, '..', 'uploads', f.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      return res.status(413).json({
        message: `Total upload size exceeds the limit of ${isPremium ? '50GB' : '500MB'}.`,
      });
    }

    // Generate unique access code
    const groupCode = await generateUniqueCode();

    // Default expiry: 24 hours from now (or 90 days for premium)
    const expiryHours = isPremium ? 24 * 90 : 24;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    // Get user master key for encryption if needed
    let masterKey = null;
    let fileKeyData = null;
    if (enableEncryption && user) {
      try {
        // Decrypt user's master key
        const encryptedMasterKey = await User.findById(user._id).select('+masterKey +masterKeySalt');
        if (encryptedMasterKey && encryptedMasterKey.masterKey) {
          masterKey = encryptionUtils.decryptMasterKeyFromStorage(encryptedMasterKey.masterKey);
          fileKeyData = encryptionUtils.generateFileKey(masterKey);
          logger.debug(`Master key retrieved for user ${user._id}`);
        }
      } catch (error) {
        logger.warn(`Could not retrieve master key for user ${user._id}:`, error.message);
        // Continue without encryption if master key unavailable
      }
    }

    // Save each file's metadata to DB
    const savedFiles = [];
    const compressionStats = [];
    let totalCompressedSize = 0;

    for (const file of req.files) {
      try {
        // Read file from disk
        const filePath = path.join(__dirname, '..', 'uploads', file.filename);
        let fileData = fs.readFileSync(filePath);
        let compressedSize = fileData.length;
        let isCompressed = false;
        let encryptionMetadata = null;

        // Step 1: Compress file if enabled
        if (enableCompression) {
          try {
            const compressedData = await compressionUtils.compressGZIP(fileData);
            const ratio = compressionUtils.calculateCompressionRatio(fileData.length, compressedData.length);
            
            logger.info(
              `[COMPRESSION] ${file.originalname}: ${compressionUtils.formatBytes(fileData.length)} → ${compressionUtils.formatBytes(compressedData.length)} (${ratio.ratio}% saved)`
            );
            
            fileData = compressedData;
            compressedSize = compressedData.length;
            isCompressed = true;
            compressionStats.push({
              name: file.originalname,
              originalSize: file.size,
              compressedSize: compressedSize,
              ratio: ratio.ratio,
            });
            totalCompressedSize += compressedSize;
          } catch (compressError) {
            logger.warn(`Compression failed for ${file.originalname}, storing uncompressed:`, compressError.message);
          }
        } else {
          totalCompressedSize += fileData.length;
        }

        // Step 2: Encrypt file if enabled
        if (enableEncryption && fileKeyData) {
          try {
            const encrypted = encryptionUtils.encryptFile(fileData, fileKeyData.fileKey);
            fileData = encrypted.encryptedData;

            encryptionMetadata = {
              enabled: true,
              algorithm: 'aes-256-gcm',
              iv: encrypted.iv,
              authTag: encrypted.authTag,
              fileKeyHash: fileKeyData.fileKeyHash,
              fileKeyNonce: fileKeyData.nonce,
            };

            logger.info(
              `[ENCRYPTION] ${file.originalname}: Encrypted with AES-256-GCM (${compressionUtils.formatBytes(fileData.length)})`
            );
          } catch (encryptError) {
            logger.error(`Encryption failed for ${file.originalname}:`, encryptError.message);
            throw encryptError;
          }
        }

        // Step 3: Save encrypted/compressed data back to disk (overwrite)
        fs.writeFileSync(filePath, fileData);

        // Step 4: Save metadata to DB
        const newFile = new File({
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          compressedSize: isCompressed ? compressedSize : null,
          isCompressed: isCompressed,
          mimetype: file.mimetype,
          groupCode,
          expiresAt,
          uploadedBy: user ? user._id : null,
          visibility: req.body.visibility || 'private',
          encryption: encryptionMetadata || { enabled: false },
          accessControl: {
            mode: req.body.accessControl?.mode || 'public',
            blockedUsers: req.body.accessControl?.blockedUsers || [],
            allowedUsers: req.body.accessControl?.allowedUsers || [],
          },
        });

        const saved = await newFile.save();
        savedFiles.push(saved);

        logger.info(
          `[UPLOAD] File saved: ${file.originalname} | Compression: ${isCompressed ? 'Yes' : 'No'} | Encryption: ${encryptionMetadata ? 'Yes' : 'No'}`
        );
      } catch (error) {
        logger.error(`Error processing file ${file.originalname}:`, error);
        // Continue with other files, but log the error
      }
    }

    // Update user storage if logged in
    if (user) {
      user.storageUsed = (user.storageUsed || 0) + totalCompressedSize;
      await user.save();
    }

    // Audit log - file upload event
    logFileUpload(req.user?._id, req.files, req.ip, req.get('user-agent'));

    // Generate QR code
    const accessUrl = `${process.env.CLIENT_URL}/access/${groupCode}`;
    const qrCodeDataUrl = await QRCode.toDataURL(accessUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    // Calculate aggregate compression stats
    const totalOriginalSize = compressionStats.reduce((sum, s) => sum + s.originalSize, 0);
    const averageCompressionRatio = compressionStats.length > 0
      ? (compressionStats.reduce((sum, s) => sum + s.ratio, 0) / compressionStats.length).toFixed(2)
      : 0;

    res.status(201).json({
      message: 'Files uploaded successfully',
      groupCode,
      accessUrl,
      qrCode: qrCodeDataUrl,
      files: savedFiles.map(f => ({
        id: f._id,
        name: f.originalName,
        size: f.size,
        compressedSize: f.compressedSize,
        mimetype: f.mimetype,
        encrypted: f.encryption?.enabled || false,
        compressed: f.isCompressed,
      })),
      expiresAt,
      compression: {
        enabled: enableCompression,
        stats: compressionStats,
        totalOriginalSize,
        totalCompressedSize,
        averageRatio: `${averageCompressionRatio}%`,
      },
      encryption: {
        enabled: enableEncryption && fileKeyData !== null,
        algorithm: enableEncryption && fileKeyData ? 'aes-256-gcm' : null,
      },
    });
  } catch (error) {
    logger.error('Upload error:', error);
    res.status(500).json({
      message: 'Server error during upload',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};
