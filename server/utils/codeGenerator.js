const crypto = require('crypto');
const File = require('../models/File');

/**
 * Generate 6-digit numeric access code.
 * Keeps regenerating until a unique one is found.
 * @returns {Promise<string>} - Unique 6-digit code
 */
async function generateUniqueCode() {
  let code;
  let exists = true;

  while (exists) {
    // Generate random 6-digit numeric code
    code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    
    // Check if this code already exists in DB
    const existing = await File.findOne({ groupCode: code });
    if (!existing) {
      exists = false;
    }
  }

  return code;
}

module.exports = { 
  generateUniqueCode
};
