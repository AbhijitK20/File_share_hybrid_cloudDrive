const crypto = require('crypto');
const File = require('../models/File');

/**
 * Generate a unique 6-digit numeric access code.
 * Keeps regenerating until a unique one is found.
 */
async function generateUniqueCode() {
  let code;
  let exists = true;

  while (exists) {
    // Generate a random 6-digit number (100000-999999)
    code = crypto.randomInt(100000, 999999).toString();
    
    // Check if this code already exists in DB
    const existing = await File.findOne({ groupCode: code });
    if (!existing) {
      exists = false;
    }
  }

  return code;
}

module.exports = { generateUniqueCode };
