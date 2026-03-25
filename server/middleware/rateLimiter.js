const rateLimit = require('express-rate-limit');

// Rate limiter for file uploads
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 uploads per IP per 15 minutes
  message: 'Too many uploads from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for premium users (if they have auth token with premium flag)
    return req.user?.isPremium === true;
  }
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
  skip: (req) => req.method !== 'POST'
});

module.exports = {
  uploadLimiter,
  accessLimiter,
  downloadLimiter,
  authLimiter
};
