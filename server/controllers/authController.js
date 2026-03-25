const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const encryptionUtils = require('../utils/encryption');
const { logger } = require('../utils/logger');
const { sendEmail, otpTemplate } = require('../utils/mailer');

const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_OTP_ATTEMPTS = 5;

/**
 * Generate JWT token for a user.
 */
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const hashOtp = (code) =>
  crypto
    .createHash('sha256')
    .update(`${code}:${process.env.JWT_SECRET}`)
    .digest('hex');

const isWithinCooldown = (lastSentAt) => {
  if (!lastSentAt) return false;
  return Date.now() - new Date(lastSentAt).getTime() < RESEND_COOLDOWN_SECONDS * 1000;
};

const cooldownRemainingSeconds = (lastSentAt) => {
  if (!lastSentAt) return 0;
  const elapsed = Date.now() - new Date(lastSentAt).getTime();
  const remainingMs = RESEND_COOLDOWN_SECONDS * 1000 - elapsed;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
};

/**
 * Register a new user with encryption support.
 * POST /api/auth/register
 * 
 * New: Generates and stores encrypted master key for file encryption
 */
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }

    // Generate encryption master key from password
    const { key: masterKey, salt: masterKeySalt } = encryptionUtils.generateMasterKey(password);
    const encryptedMasterKey = encryptionUtils.encryptMasterKeyForStorage(masterKey);

    // Create user with encryption fields
    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      masterKey: encryptedMasterKey,
      masterKeySalt: masterKeySalt,
      encryptionEnabled: true, // Enable encryption by default
      isEmailVerified: false,
    });

    const code = generateOtp();
    user.emailVerification = {
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
      attempts: 0,
      lastSentAt: new Date(),
    };
    await user.save();

    try {
      const tpl = otpTemplate('Verify your FileShare email', code, OTP_TTL_MINUTES);
      await sendEmail({
        to: user.email,
        subject: 'FileShare email verification code',
        text: tpl.text,
        html: tpl.html,
      });
    } catch (mailErr) {
      logger.error(`[AUTH] Failed to send verification email: ${mailErr.message}`);
    }

    // Generate token
    const token = generateToken(user._id);

    logger.info(`[AUTH] New user registered: ${user._id} with encryption enabled`);

    res.status(201).json({
      message: 'Account created successfully with encryption enabled',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        encryptionEnabled: user.encryptionEnabled,
        isEmailVerified: user.isEmailVerified,
      },
    });
  } catch (error) {
    logger.error('Register error:', error);
    if (error.code === 11000) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }
    res.status(500).json({ message: 'Server error during registration' });
  }
};

/**
 * Login user with encryption key retrieval.
 * POST /api/auth/login
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user with password and encryption fields
    const user = await User.findOne({ email: normalizedEmail }).select('+password +masterKey +masterKeySalt');
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Compare passwords
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Verify and retrieve master key if encryption is enabled
    let encryptionStatus = 'disabled';
    if (user.encryptionEnabled && user.masterKey) {
      try {
        // Test that we can decrypt the master key
        encryptionUtils.decryptMasterKeyFromStorage(user.masterKey);
        encryptionStatus = 'enabled';
        logger.debug(`[AUTH] Master key verified for user ${user._id}`);
      } catch (decryptError) {
        logger.warn(`[AUTH] Could not verify master key for user ${user._id}:`, decryptError.message);
        encryptionStatus = 'error';
      }
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        encryptionEnabled: user.encryptionEnabled,
        encryptionStatus: encryptionStatus,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionEndDate: user.subscriptionEndDate,
        isEmailVerified: user.isEmailVerified,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};

/**
 * Get current user profile with encryption/subscription status.
 * GET /api/auth/me
 */
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password +masterKey +masterKeySalt');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if subscription has expired
    if (user.plan === 'premium' && user.subscriptionEndDate && user.subscriptionEndDate < new Date()) {
      user.plan = 'free';
      user.subscriptionStatus = 'expired';
      await user.save();
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        encryptionEnabled: user.encryptionEnabled,
        masterKey: user.masterKey ? 'present' : null, // Don't expose actual key, just indicate presence
        masterKeySalt: user.masterKeySalt ? 'present' : null,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionEndDate: user.subscriptionEndDate,
        storageUsed: user.storageUsed,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    logger.error('Get me error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Upgrade a user to premium plan (via payment verification).
 * POST /api/auth/upgrade
 * Protected route
 */
exports.upgradeToPremium = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.plan === 'premium' && user.subscriptionStatus === 'active') {
      return res.status(400).json({ message: 'User already has an active premium subscription' });
    }

    // This is a legacy endpoint - use /api/payment/verify for real upgrades
    user.plan = 'premium';
    user.subscriptionStatus = 'active';
    user.subscriptionStartDate = new Date();
    user.subscriptionEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await user.save();

    logger.info(`[AUTH] User ${user._id} upgraded to premium`);

    res.json({
      message: 'Successfully upgraded to premium!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionEndDate: user.subscriptionEndDate,
      },
    });
  } catch (error) {
    logger.error('Upgrade error:', error);
    res.status(500).json({ message: 'Server error during upgrade' });
  }
};

exports.checkEmailExists = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const exists = await User.exists({ email });
    return res.json({ exists: Boolean(exists) });
  } catch (error) {
    logger.error(`Email exists check error: ${error.message}`);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.verifyEmailCode = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || '').trim();

    if (!email || !code) {
      return res.status(400).json({ message: 'Email and code are required' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.emailVerification?.codeHash || !user.emailVerification?.expiresAt) {
      return res.status(400).json({ message: 'No active verification code. Please resend.' });
    }

    if (new Date() > new Date(user.emailVerification.expiresAt)) {
      return res.status(400).json({ message: 'Verification code expired. Please resend.' });
    }

    if ((user.emailVerification.attempts || 0) >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many attempts. Please resend a new code.' });
    }

    if (user.emailVerification.codeHash !== hashOtp(code)) {
      user.emailVerification.attempts = (user.emailVerification.attempts || 0) + 1;
      await user.save();
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    user.isEmailVerified = true;
    user.emailVerification = {
      codeHash: null,
      expiresAt: null,
      attempts: 0,
      lastSentAt: user.emailVerification.lastSentAt,
    };
    await user.save();

    return res.json({ message: 'Email verified successfully' });
  } catch (error) {
    logger.error(`Verify email error: ${error.message}`);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.resendEmailVerificationCode = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.isEmailVerified) {
      return res.status(400).json({ message: 'Email is already verified' });
    }

    if (isWithinCooldown(user.emailVerification?.lastSentAt)) {
      const remaining = cooldownRemainingSeconds(user.emailVerification?.lastSentAt);
      return res.status(200).json({
        message: `Verification code already sent recently. Please wait ${remaining}s and try again.`,
      });
    }

    const code = generateOtp();
    user.emailVerification = {
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
      attempts: 0,
      lastSentAt: new Date(),
    };
    await user.save();

    const tpl = otpTemplate('Verify your FileShare email', code, OTP_TTL_MINUTES);
    await sendEmail({
      to: user.email,
      subject: 'FileShare email verification code',
      text: tpl.text,
      html: tpl.html,
    });

    return res.json({ message: 'Verification code sent' });
  } catch (error) {
    logger.error(`Resend verification error: ${error.message}`);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email }).select('+masterKey +masterKeySalt');

    // Security: same response regardless of existence
    if (!user) {
      return res.json({ message: 'If this email exists, a reset code has been sent.' });
    }

    if (isWithinCooldown(user.passwordReset?.lastSentAt)) {
      const remaining = cooldownRemainingSeconds(user.passwordReset?.lastSentAt);
      return res.status(200).json({
        message: `Reset code already sent recently. Please wait ${remaining}s and try again.`,
      });
    }

    const code = generateOtp();
    user.passwordReset = {
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
      attempts: 0,
      lastSentAt: new Date(),
    };
    await user.save();

    const tpl = otpTemplate('Reset your FileShare password', code, OTP_TTL_MINUTES);
    await sendEmail({
      to: user.email,
      subject: 'FileShare password reset code',
      text: tpl.text,
      html: tpl.html,
    });

    return res.json({ message: 'If this email exists, a reset code has been sent.' });
  } catch (error) {
    logger.error(`Forgot password error: ${error.message}`);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || '').trim();
    const newPassword = String(req.body.newPassword || '');

    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: 'Email, code and newPassword are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ email }).select('+password +masterKey +masterKeySalt');
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.passwordReset?.codeHash || !user.passwordReset?.expiresAt) {
      return res.status(400).json({ message: 'No active reset code. Please request again.' });
    }

    if (new Date() > new Date(user.passwordReset.expiresAt)) {
      return res.status(400).json({ message: 'Reset code expired. Please request again.' });
    }

    if ((user.passwordReset.attempts || 0) >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many attempts. Please request a new code.' });
    }

    if (user.passwordReset.codeHash !== hashOtp(code)) {
      user.passwordReset.attempts = (user.passwordReset.attempts || 0) + 1;
      await user.save();
      return res.status(400).json({ message: 'Invalid reset code' });
    }

    const { key: masterKey, salt: masterKeySalt } = encryptionUtils.generateMasterKey(newPassword);
    user.masterKey = encryptionUtils.encryptMasterKeyForStorage(masterKey);
    user.masterKeySalt = masterKeySalt;
    user.password = newPassword;
    user.passwordReset = {
      codeHash: null,
      expiresAt: null,
      attempts: 0,
      lastSentAt: user.passwordReset.lastSentAt,
    };

    await user.save();
    return res.json({ message: 'Password reset successful. Please login.' });
  } catch (error) {
    logger.error(`Reset password error: ${error.message}`);
    return res.status(500).json({ message: 'Server error' });
  }
};
