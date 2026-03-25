const mongoose = require('mongoose');

const paymentEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    paymentId: { type: String, default: null, index: true },
    orderId: { type: String, default: null, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    eventType: { type: String, required: true },
    processedAt: { type: Date, default: Date.now },
    payloadHash: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentEvent', paymentEventSchema);

