const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: 2,
    maxlength: 50,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
  },
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  emailVerification: {
    codeHash: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
  },
  passwordReset: {
    codeHash: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false, // Never return password by default
  },
  plan: {
    type: String,
    enum: ['free', 'premium'],
    default: 'free',
  },
  storageUsed: {
    type: Number,
    default: 0, // in bytes
  },
  // Encryption fields
  masterKey: {
    type: String,
    default: null, // Encrypted master key stored as JSON string
    select: false, // Never return by default
  },
  masterKeySalt: {
    type: String,
    default: null, // Salt used for key derivation
    select: false,
  },
  encryptionEnabled: {
    type: Boolean,
    default: false, // Flag to indicate if encryption is enabled for this user
  },
  // Subscription fields for Razorpay
  subscriptionId: {
    type: String,
    default: null,
  },
  subscriptionStatus: {
    type: String,
    enum: ['active', 'expired', 'cancelled', 'pending'],
    default: null,
  },
  subscriptionStartDate: {
    type: Date,
    default: null,
  },
  subscriptionEndDate: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
  autoIndex: false, // Avoid MongoServerError on index creation
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
