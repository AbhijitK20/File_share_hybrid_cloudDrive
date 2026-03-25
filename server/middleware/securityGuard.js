const { logger } = require('../utils/logger');

function hasDangerousKeys(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasDangerousKeys);

  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) return true;
    if (hasDangerousKeys(value[key])) return true;
  }
  return false;
}

function stripPrototypePollution(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripPrototypePollution);

  const clean = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    clean[k] = stripPrototypePollution(v);
  }
  return clean;
}

const requestSecurityGuard = (req, res, next) => {
  try {
    req.body = stripPrototypePollution(req.body);
    req.query = stripPrototypePollution(req.query);
    req.params = stripPrototypePollution(req.params);

    if (hasDangerousKeys(req.body) || hasDangerousKeys(req.query) || hasDangerousKeys(req.params)) {
      logger.warn(`[SECURITY] Rejected suspicious operator payload on ${req.method} ${req.path}`);
      return res.status(400).json({ message: 'Suspicious input detected' });
    }

    return next();
  } catch (error) {
    logger.error(`[SECURITY] requestSecurityGuard error: ${error.message}`);
    return res.status(500).json({ message: 'Security validation failed' });
  }
};

module.exports = { requestSecurityGuard };

