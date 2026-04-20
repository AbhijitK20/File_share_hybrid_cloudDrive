const rateLimit = require('express-rate-limit');

const isPremiumUser = (req) => String(req.user?.plan || '').toLowerCase() === 'premium';

const getClientIdentifier = (req) => {
  if (req.user?.id) return `user:${req.user.id}`;
  return req.ip;
};

// Rate limiter for file uploads
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => (isPremiumUser(req) ? 120 : 20), // Higher allowance for premium users
  keyGenerator: getClientIdentifier,
  message: 'Too many uploads from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for file access/preview (stricter for brute force protection)
const accessLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 access attempts per IP per minute
  message: 'Too many access attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for download (moderate limit)
const downloadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50, // 50 downloads per IP per minute
  message: 'Too many downloads, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for authentication attempts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 failed attempts per IP
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) => req.method !== 'POST'
});

module.exports = {
  uploadLimiter,
  accessLimiter,
  downloadLimiter,
  authLimiter
};
