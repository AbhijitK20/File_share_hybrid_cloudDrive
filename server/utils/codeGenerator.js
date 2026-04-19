const crypto = require('crypto');
const supabase = require('./supabase');

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

    // Reuse code only when no active group currently uses it.
    const { data, error } = await supabase
      .from('files')
      .select('id')
      .eq('group_code', code)
      .gt('expires_at', new Date().toISOString())
      .limit(1);

    if (error) {
      throw new Error(`Unable to validate access code uniqueness: ${error.message}`);
    }

    if (!data || data.length === 0) {
      exists = false;
    }
  }

  return code;
}

module.exports = { 
  generateUniqueCode
};
