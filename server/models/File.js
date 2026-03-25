const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true,
  },
  originalName: {
    type: String,
    required: true,
  },
  size: {
    type: Number,
    required: true,
  },
  compressedSize: {
    type: Number,
    default: null, // Size after compression
  },
  isCompressed: {
    type: Boolean,
    default: false,
  },
  mimetype: {
    type: String,
    required: true,
  },
  groupCode: {
    type: String,
    required: true,
    index: true,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  visibility: {
    type: String,
    enum: ['public', 'private', 'shared'],
    default: 'public',
  },
  allowedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  // Access Control Fields
  accessControl: {
    mode: {
      type: String,
      enum: ['public', 'allowlist', 'blocklist'],
      default: 'public',
    },
    blockedUsers: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      blockedAt: {
        type: Date,
        default: Date.now,
      },
    }],
    allowedUsers: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      permissions: [{
        type: String,
        enum: ['view', 'edit', 'delete'],
        default: 'view',
      }],
      grantedAt: {
        type: Date,
        default: Date.now,
      },
    }],
  },
  accessInsights: {
    viewedBy: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      email: String,
      name: String,
      count: { type: Number, default: 0 },
      lastAt: { type: Date, default: Date.now },
    }],
    editedBy: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      email: String,
      name: String,
      count: { type: Number, default: 0 },
      lastAt: { type: Date, default: Date.now },
    }],
  },
  activityLogs: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    email: String,
    name: String,
    action: {
      type: String,
      enum: [
        'upload',
        'preview',
        'download',
        'share_granted',
        'share_removed',
        'permission_updated',
        'visibility_changed',
        'expiry_extended',
      ],
    },
    details: String,
    at: {
      type: Date,
      default: Date.now,
    },
  }],
  // Encryption Fields
  encryption: {
    enabled: {
      type: Boolean,
      default: false,
    },
    algorithm: {
      type: String,
      enum: ['aes-256-gcm'],
      default: 'aes-256-gcm',
    },
    iv: {
      type: String,
      default: null, // Hex string
    },
    authTag: {
      type: String,
      default: null, // Hex string for GCM authentication
    },
    fileKeyHash: {
      type: String,
      default: null, // Hash of the file-specific encryption key
    },
    fileKeyNonce: {
      type: String,
      default: null, // Hex nonce used for HKDF file key derivation
    },
  },
  expiresAt: {
    type: Date,
    required: true,
  },
}, {
  timestamps: true,
});

// Index for expiry cleanup
fileSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('File', fileSchema);
