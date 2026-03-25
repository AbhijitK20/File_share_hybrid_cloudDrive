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
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/email-exists', checkEmailExists);
router.post('/verify-email', verifyEmailCode);
router.post('/resend-verification', resendEmailVerificationCode);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', protect, getMe);
router.post('/upgrade', protect, upgradeToPremium);

module.exports = router;
