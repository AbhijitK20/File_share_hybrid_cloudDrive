const supabase = require('../utils/supabase');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const encryptionUtils = require('../utils/encryption');
const { logger } = require('../utils/logger');
const { sendEmail, otpTemplate } = require('../utils/mailer');

const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_OTP_ATTEMPTS = 5;
const googleClient = new OAuth2Client();

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const hashOtp = (code) =>
  crypto.createHash('sha256').update(`${code}:${process.env.JWT_SECRET}`).digest('hex');
const getGoogleClientIds = () =>
  String(process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

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

const buildOtpPayload = (code) => ({
  codeHash: hashOtp(code),
  expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString(),
  attempts: 0,
  lastSentAt: new Date().toISOString(),
});

const toPublicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  plan: user.plan,
  storageUsed: user.storage_used,
  createdAt: user.created_at,
  encryptionEnabled: user.encryption_enabled,
  isEmailVerified: user.is_email_verified,
  subscriptionStatus: user.subscription_status,
  subscriptionEndDate: user.subscription_end_date,
});

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    const { key: masterKey, salt: masterKeySalt } = encryptionUtils.generateMasterKey(password);
    const encryptedMasterKey = encryptionUtils.encryptMasterKeyForStorage(masterKey);

    const code = generateOtp();
    const { data: user, error } = await supabase
      .from('users')
      .insert([{
        name,
        email: normalizedEmail,
        password: hashedPassword,
        master_key: encryptedMasterKey,
        master_key_salt: masterKeySalt,
        encryption_enabled: true,
        is_email_verified: false,
        email_verification: buildOtpPayload(code),
      }])
      .select()
      .single();

    if (error) throw error;

    try {
      const tpl = otpTemplate('Verify your FileShare email', code, OTP_TTL_MINUTES);
      await sendEmail({ to: user.email, subject: 'FileShare email verification code', ...tpl });
    } catch (mailErr) {
      logger.error(`[AUTH] email failed: ${mailErr.message}`);
    }

    const token = generateToken(user.id);
    res.status(201).json({
      message: 'Account created!',
      token,
      user: toPublicUser(user)
    });
  } catch (error) {
    logger.error('Register error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (error || !user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = generateToken(user.id);
    res.json({
      message: 'Login successful',
      token,
      user: toPublicUser(user),
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};

exports.googleSignIn = async (req, res) => {
  try {
    const idToken = String(req.body.idToken || '').trim();
    if (!idToken) {
      return res.status(400).json({ message: 'Google token is required' });
    }

    const googleClientIds = getGoogleClientIds();
    if (googleClientIds.length === 0) {
      logger.error('[AUTH] Google sign-in is not configured (missing GOOGLE_CLIENT_ID)');
      return res.status(500).json({ message: 'Google sign-in is not configured' });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: googleClientIds,
      });
      payload = ticket.getPayload();
    } catch (verifyError) {
      return res.status(401).json({ message: 'Invalid Google token' });
    }

    const normalizedEmail = normalizeEmail(payload?.email);
    if (!normalizedEmail || payload?.email_verified !== true) {
      return res.status(401).json({ message: 'Google account email is not verified' });
    }

    const { data: existingUser, error: existingError } = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingError) throw existingError;

    let user = existingUser;

    if (!user) {
      const generatedPassword = crypto.randomBytes(32).toString('hex');
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(generatedPassword, salt);
      const { key: masterKey, salt: masterKeySalt } = encryptionUtils.generateMasterKey(generatedPassword);
      const encryptedMasterKey = encryptionUtils.encryptMasterKeyForStorage(masterKey);

      const fallbackName = normalizedEmail.split('@')[0] || 'Google User';
      const displayName = String(payload?.name || '').trim() || fallbackName;

      const { data: createdUser, error: createError } = await supabase
        .from('users')
        .insert([{
          name: displayName,
          email: normalizedEmail,
          password: hashedPassword,
          master_key: encryptedMasterKey,
          master_key_salt: masterKeySalt,
          encryption_enabled: true,
          is_email_verified: true,
          email_verification: null,
        }])
        .select()
        .single();

      if (createError) {
        const isDuplicateEmail =
          String(createError.code || '').includes('23505')
          || String(createError.message || '').toLowerCase().includes('duplicate');

        if (!isDuplicateEmail) throw createError;

        const { data: racedUser, error: raceLookupError } = await supabase
          .from('users')
          .select('*')
          .eq('email', normalizedEmail)
          .maybeSingle();

        if (raceLookupError || !racedUser) throw createError;
        user = racedUser;
      } else {
        user = createdUser;
      }
    }

    const token = generateToken(user.id);
    return res.json({
      message: 'Google sign-in successful',
      token,
      user: toPublicUser(user),
    });
  } catch (error) {
    logger.error('Google sign-in error:', error);
    return res.status(500).json({ message: 'Server error during Google sign-in' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error || !user) return res.status(404).json({ message: 'User not found' });

    res.json({ user: toPublicUser(user) });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.checkEmailExists = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { data } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
  res.json({ exists: !!data });
};

exports.verifyEmailCode = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || '').trim();

    if (!email || !code) {
      return res.status(400).json({ message: 'Email and code are required' });
    }

    const { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    const verification = user?.email_verification || null;

    if (!user || !verification?.codeHash) {
      return res.status(400).json({ message: 'Invalid code' });
    }

    if (verification.expiresAt && new Date(verification.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ message: 'Code expired' });
    }

    const attempts = Number(verification.attempts || 0);
    if (attempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many attempts. Please resend a new code.' });
    }

    if (verification.codeHash !== hashOtp(code)) {
      await supabase
        .from('users')
        .update({
          email_verification: {
            ...verification,
            attempts: attempts + 1,
          },
        })
        .eq('id', user.id);

      return res.status(400).json({ message: 'Invalid code' });
    }

    await supabase
      .from('users')
      .update({ is_email_verified: true, email_verification: null })
      .eq('id', user.id);

    return res.json({ message: 'Verified' });
  } catch (error) {
    logger.error('Verify email code error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.resendEmailVerificationCode = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    if (!user) {
      // Avoid leaking whether email exists.
      return res.json({ message: 'If this email exists, a verification code was sent.' });
    }

    if (user.is_email_verified) {
      return res.status(400).json({ message: 'Email is already verified' });
    }

    const lastSentAt = user.email_verification?.lastSentAt;
    if (isWithinCooldown(lastSentAt)) {
      return res.status(429).json({
        message: 'Please wait before requesting another code',
        waitSeconds: cooldownRemainingSeconds(lastSentAt),
      });
    }

    const code = generateOtp();
    const emailVerification = buildOtpPayload(code);

    await supabase
      .from('users')
      .update({ email_verification: emailVerification })
      .eq('id', user.id);

    try {
      const tpl = otpTemplate('Verify your FileShare email', code, OTP_TTL_MINUTES);
      await sendEmail({ to: user.email, subject: 'FileShare email verification code', ...tpl });
    } catch (mailErr) {
      logger.error(`[AUTH] resend verification email failed: ${mailErr.message}`);
    }

    return res.json({ message: 'Verification code sent' });
  } catch (error) {
    logger.error('Resend verification error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    if (!user) {
      return res.json({ message: 'Code sent if email exists' });
    }

    const lastSentAt = user.password_reset?.lastSentAt;
    if (isWithinCooldown(lastSentAt)) {
      return res.status(429).json({
        message: 'Please wait before requesting another code',
        waitSeconds: cooldownRemainingSeconds(lastSentAt),
      });
    }

    const code = generateOtp();
    const passwordReset = buildOtpPayload(code);

    await supabase.from('users').update({ password_reset: passwordReset }).eq('id', user.id);

    try {
      const tpl = otpTemplate('Reset your FileShare password', code, OTP_TTL_MINUTES);
      await sendEmail({
        to: user.email,
        subject: 'FileShare password reset code',
        ...tpl,
        requireSmtp: true,
      });
    } catch (mailErr) {
      logger.error(`[AUTH] forgot password email failed: ${mailErr.message}`);
      return res.status(500).json({
        message: 'Unable to send reset email right now. Check SMTP settings and try again.',
      });
    }

    return res.json({ message: 'Code sent if email exists' });
  } catch (error) {
    logger.error('Forgot password error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !code || !newPassword) {
      return res.status(400).json({ message: 'Email, code and new password are required' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();

    const passwordReset = user?.password_reset || null;
    if (!user || !passwordReset?.codeHash) {
      return res.status(400).json({ message: 'Invalid code' });
    }

    if (passwordReset.expiresAt && new Date(passwordReset.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ message: 'Code expired' });
    }

    if (passwordReset.codeHash !== hashOtp(String(code).trim())) {
      return res.status(400).json({ message: 'Invalid code' });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await supabase
      .from('users')
      .update({
        password: hashedPassword,
        password_reset: null,
      })
      .eq('id', user.id);

    return res.json({ message: 'Password updated successfully' });
  } catch (error) {
    logger.error('Reset password error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.upgradeToPremium = async (req, res) => {
  try {
    const subscriptionEndDate = new Date();
    subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);

    const { data: user, error } = await supabase
      .from('users')
      .update({
        plan: 'premium',
        subscription_status: 'active',
        subscription_end_date: subscriptionEndDate.toISOString(),
      })
      .eq('id', req.user.id)
      .select('*')
      .single();

    if (error || !user) {
      return res.status(500).json({ message: 'Unable to upgrade user plan' });
    }

    return res.json({
      success: true,
      message: 'Upgraded to premium successfully',
      user: toPublicUser(user),
    });
  } catch (error) {
    logger.error('Upgrade to premium error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
