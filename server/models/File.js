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
