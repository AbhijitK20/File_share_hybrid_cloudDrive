const supabase = require('../utils/supabase');
const { generateUniqueCode } = require('../utils/codeGenerator');
const { logFileUpload, logger } = require('../utils/logger');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const encryptionUtils = require('../utils/encryption');
const compressionUtils = require('../utils/compression');

const ALLOWED_VISIBILITY = ['public', 'private'];
const ALLOWED_ACCESS_MODES = ['public', 'allowlist', 'blocklist'];
const AUTHENTICATED_EXPIRY_HOURS = 24;
const ANONYMOUS_EXPIRY_HOURS = 1;

/**
 * Upload multiple files to Supabase Storage.
 */
exports.uploadFiles = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    let user = null;
    if (req.user) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.user.id)
        .single();
      if (!error) user = data;
    }

    const isPremium = user?.plan === 'premium';
    const MAX_FILE_SIZE = isPremium ? 5 * 1024 * 1024 * 1024 : 100 * 1024 * 1024;
    
    // Check sizes
    for (const file of req.files) {
      if (file.size > MAX_FILE_SIZE) {
        return res.status(413).json({
          message: `File ${file.originalname} exceeds the limit of ${isPremium ? '5GB' : '100MB'}.`,
        });
      }
    }

    const groupCode = await generateUniqueCode();
    // Guest uploads expire faster to keep storage/database lean.
    // Signed-in uploads keep the default 24h window and Pro can extend later.
    const expiryHours = user ? AUTHENTICATED_EXPIRY_HOURS : ANONYMOUS_EXPIRY_HOURS;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

    let visibility = ALLOWED_VISIBILITY.includes(req.body.visibility) ? req.body.visibility : 'public';
    let accessMode = ALLOWED_ACCESS_MODES.includes(req.body.accessMode) ? req.body.accessMode : 'public';

    // Anonymous uploads must remain publicly accessible by code.
    if (!user) {
      visibility = 'public';
      accessMode = 'public';
    }

    const enableEncryption = req.body.enableEncryption !== 'false' && user?.encryption_enabled !== false;
    const enableCompression = req.body.enableCompression !== 'false';

    let masterKey = null;
    let fileKeyData = null;
    if (enableEncryption && user?.master_key) {
      try {
        masterKey = encryptionUtils.decryptMasterKeyFromStorage(user.master_key);
        fileKeyData = encryptionUtils.generateFileKey(masterKey);
      } catch (err) {
        logger.warn(`Master key error: ${err.message}`);
      }
    }

    const savedFiles = [];
    let totalCompressedSize = 0;

    for (const file of req.files) {
      try {
        let fileData = file.buffer; // Multer memoryStorage provides file.buffer
        let compressedSize = file.size;
        let isCompressed = false;
        let encryptionMetadata = { enabled: false };

        if (enableCompression) {
          try {
            const compressed = await compressionUtils.compressGZIP(fileData);
            fileData = compressed;
            compressedSize = compressed.length;
            isCompressed = true;
          } catch (e) {
            logger.warn(`Compression failed for ${file.originalname}`);
          }
        }
        totalCompressedSize += compressedSize;

        if (enableEncryption && fileKeyData) {
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
        }

        const supabaseFilename = `${uuidv4()}-${file.originalname}`;
        
        // Upload to Supabase Storage (Bucket: 'uploads')
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('uploads')
          .upload(supabaseFilename, fileData, {
            contentType: file.mimetype,
            upsert: false
          });

        if (uploadError) throw uploadError;

        const { data: newFile, error: dbError } = await supabase
          .from('files')
          .insert([{
            filename: supabaseFilename,
            original_name: file.originalname,
            size: file.size,
            compressed_size: isCompressed ? compressedSize : null,
            is_compressed: isCompressed,
            mimetype: file.mimetype,
            group_code: groupCode,
            expires_at: expiresAt,
            uploaded_by_id: user ? user.id : null,
            visibility,
            access_mode: accessMode,
            encryption: encryptionMetadata
          }])
          .select()
          .single();

        if (dbError) throw dbError;
        savedFiles.push(newFile);
      } catch (error) {
        logger.error(`Error processing ${file.originalname}:`, error);
      }
    }

    if (user) {
      await supabase
        .from('users')
        .update({ storage_used: (user.storage_used || 0) + totalCompressedSize })
        .eq('id', user.id);
    }

    const accessUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/access/${groupCode}`;
    const qrCodeDataUrl = await QRCode.toDataURL(accessUrl);

    res.status(201).json({
      message: 'Files uploaded successfully to cloud storage',
      groupCode,
      accessUrl,
      qrCode: qrCodeDataUrl,
      files: savedFiles.map(f => ({
        id: f.id,
        name: f.original_name,
        size: f.size,
        encrypted: f.encryption?.enabled || false,
      })),
      expiresAt,
    });
  } catch (error) {
    logger.error('Upload error:', error);
    res.status(500).json({ message: 'Server error during upload' });
  }
};
