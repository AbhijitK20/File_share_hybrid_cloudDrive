const crypto = require('crypto');
const { logger } = require('./logger');

/**
 * Encryption utility for file encryption/decryption with AES-256-GCM
 * Uses both master keys (per user) and per-file unique keys for enhanced security
 */

/**
 * Generate a user master key from password + unique salt
 * @param {string} password - User password
 * @param {string} salt - Optional salt (if not provided, generates new one)
 * @returns {object} { key, salt, keyHash }
 */
exports.generateMasterKey = (password, salt = null) => {
  try {
    if (!salt) {
      salt = crypto.randomBytes(32).toString('hex');
    }

    // Derive key using PBKDF2 - 100,000 iterations
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');

    logger.debug('Master key generated successfully');
    return { key, salt, keyHash };
  } catch (error) {
    logger.error('Error generating master key:', error);
    throw error;
  }
};

/**
 * Generate a unique per-file encryption key derived from master key
 * @param {Buffer} masterKey - User's master key
 * @returns {object} { fileKey, fileKeyHash }
 */
exports.generateFileKey = (masterKey, nonceHex = null) => {
  try {
    // Ensure masterKey is a Buffer (may come as ArrayBuffer from decryption)
    if (!(masterKey instanceof Buffer)) {
      if (masterKey instanceof ArrayBuffer) {
        masterKey = Buffer.from(masterKey);
      } else if (typeof masterKey === 'string') {
        masterKey = Buffer.from(masterKey, 'hex');
      }
    }
    
    // Generate random nonce (or reuse stored nonce for deterministic decryption)
    const nonce = nonceHex ? Buffer.from(nonceHex, 'hex') : crypto.randomBytes(16);
    const fileKey = crypto.hkdfSync('sha256', masterKey, nonce, 'file-encryption', 32);
    const fileKeyHash = crypto.createHash('sha256').update(fileKey).digest('hex');

    logger.debug('File key generated successfully');
    return { fileKey, fileKeyHash, nonce: nonce.toString('hex') };
  } catch (error) {
    logger.error('Error generating file key:', error);
    throw error;
  }
};

/**
 * Encrypt file buffer with AES-256-GCM
 * @param {Buffer} fileBuffer - File data to encrypt
 * @param {Buffer} fileKey - Encryption key
 * @returns {object} { encryptedData, iv, authTag }
 */
exports.encryptFile = (fileBuffer, fileKey) => {
  try {
    const iv = crypto.randomBytes(16); // Initialization Vector
    const cipher = crypto.createCipheriv('aes-256-gcm', fileKey, iv);

    let encryptedData = cipher.update(fileBuffer);
    encryptedData = Buffer.concat([encryptedData, cipher.final()]);

    const authTag = cipher.getAuthTag(); // For authenticated encryption

    logger.debug('File encrypted successfully');
    return {
      encryptedData,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  } catch (error) {
    logger.error('Error encrypting file:', error);
    throw error;
  }
};

/**
 * Decrypt file buffer with AES-256-GCM
 * @param {Buffer} encryptedData - Encrypted file data
 * @param {Buffer} fileKey - Decryption key
 * @param {string} iv - Initialization vector (hex string)
 * @param {string} authTag - Authentication tag (hex string)
 * @returns {Buffer} Decrypted file data
 */
exports.decryptFile = (encryptedData, fileKey, iv, authTag) => {
  try {
    const ivBuffer = Buffer.from(iv, 'hex');
    const authTagBuffer = Buffer.from(authTag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', fileKey, ivBuffer);
    decipher.setAuthTag(authTagBuffer);

    let decryptedData = decipher.update(encryptedData);
    decryptedData = Buffer.concat([decryptedData, decipher.final()]);

    logger.debug('File decrypted successfully');
    return decryptedData;
  } catch (error) {
    logger.error('Error decrypting file:', error);
    throw new Error('Decryption failed - file may be corrupted or tampered');
  }
};

/**
 * Encrypt master key before storing in database
 * Uses a fixed application-level key (from environment)
 * @param {Buffer} masterKey - Master key to encrypt
 * @returns {string} Encrypted master key (hex string)
 */
exports.encryptMasterKeyForStorage = (masterKey) => {
  try {
    // Use a fixed application key for encrypting master keys
    const appKey = crypto.scryptSync(process.env.JWT_SECRET, 'app-master-key-salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', appKey, iv);

    let encrypted = cipher.update(masterKey);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();
    // Return as JSON string for database storage
    const encryptionData = {
      encrypted: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };

    logger.debug('Master key encrypted for storage');
    return JSON.stringify(encryptionData);
  } catch (error) {
    logger.error('Error encrypting master key for storage:', error);
    throw error;
  }
};

/**
 * Decrypt master key from database storage
 * @param {string} encryptedMasterKeyData - Encrypted master key data (JSON string)
 * @returns {Buffer} Decrypted master key
 */
exports.decryptMasterKeyFromStorage = (encryptedMasterKeyData) => {
  try {
    const appKey = crypto.scryptSync(process.env.JWT_SECRET, 'app-master-key-salt', 32);
    const data = JSON.parse(encryptedMasterKeyData);

    const ivBuffer = Buffer.from(data.iv, 'hex');
    const authTagBuffer = Buffer.from(data.authTag, 'hex');
    const encryptedBuffer = Buffer.from(data.encrypted, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', appKey, ivBuffer);
    decipher.setAuthTag(authTagBuffer);

    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    logger.debug('Master key decrypted from storage');
    return decrypted;
  } catch (error) {
    logger.error('Error decrypting master key from storage:', error);
    throw new Error('Failed to decrypt master key');
  }
};

/**
 * Generate HMAC for integrity verification
 * @param {Buffer} data - Data to generate HMAC for
 * @param {Buffer} key - Key for HMAC
 * @returns {string} HMAC hex string
 */
exports.generateHMAC = (data, key) => {
  try {
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(data);
    return hmac.digest('hex');
  } catch (error) {
    logger.error('Error generating HMAC:', error);
    throw error;
  }
};

/**
 * Verify HMAC integrity
 * @param {Buffer} data - Original data
 * @param {string} hmac - HMAC to verify (hex string)
 * @param {Buffer} key - Key used for HMAC
 * @returns {boolean} True if HMAC is valid
 */
exports.verifyHMAC = (data, hmac, key) => {
  try {
    const expectedHmac = exports.generateHMAC(data, key);
    return crypto.timingSafeEqual(
      Buffer.from(hmac, 'hex'),
      Buffer.from(expectedHmac, 'hex')
    );
  } catch (error) {
    logger.error('Error verifying HMAC:', error);
    return false;
  }
};

module.exports = exports;
