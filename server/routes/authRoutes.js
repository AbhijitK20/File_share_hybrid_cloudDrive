const express = require('express');
const {
  register,
  login,
  getMe,
  upgradeToPremium,
  checkEmailExists,
  verifyEmailCode,
  resendEmailVerificationCode,
  forgotPassword,
  resetPassword,
  googleSignIn,
  getGoogleConfig,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/google', authLimiter, googleSignIn);
router.get('/google/config', getGoogleConfig);
router.post('/email-exists', authLimiter, checkEmailExists);
router.post('/verify-email', authLimiter, verifyEmailCode);
router.post('/resend-verification', authLimiter, resendEmailVerificationCode);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.get('/me', protect, getMe);
router.post('/upgrade', protect, upgradeToPremium);

module.exports = router;
