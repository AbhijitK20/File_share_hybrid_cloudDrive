const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User');
const PaymentEvent = require('../models/PaymentEvent');
const { logger } = require('../utils/logger');

/**
 * Initialize Razorpay instance with keys from environment variables
 */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Subscription plans with pricing and features
 */
const SUBSCRIPTION_PLANS = {
  free: {
    name: 'Free Plan',
    maxFileSize: 100 * 1024 * 1024, // 100 MB
    totalStorage: 500 * 1024 * 1024, // 500 MB
    fileExpiry: 24, // hours
    maxUploadPerDay: 5,
  },
  premium: {
    name: 'Premium Plan',
    maxFileSize: 5 * 1024 * 1024 * 1024, // 5 GB
    totalStorage: 50 * 1024 * 1024 * 1024, // 50 GB
    fileExpiry: 90, // days
    maxUploadPerDay: 100,
    price: 149, // ₹149 per month
    interval: 'monthly', // billing interval
  },
};

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function applyPremiumForPayment({ userId, orderId, paymentId, source }) {
  const user = await User.findById(userId);
  if (!user) return { ok: false, status: 404, message: 'User not found' };

  if (user.subscriptionStatus === 'active' && user.subscriptionEndDate && user.subscriptionEndDate > new Date()) {
    return { ok: true, alreadyActive: true, user };
  }

  const subscriptionStartDate = new Date();
  const subscriptionEndDate = new Date();
  subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);

  user.plan = 'premium';
  user.subscriptionId = orderId || paymentId || user.subscriptionId;
  user.subscriptionStatus = 'active';
  user.subscriptionStartDate = subscriptionStartDate;
  user.subscriptionEndDate = subscriptionEndDate;
  await user.save();

  logger.info(
    `[PAYMENT] User ${user._id} upgraded via ${source}. Ends: ${subscriptionEndDate.toISOString()}`
  );

  return { ok: true, alreadyActive: false, user };
}

/**
 * Create a new Razorpay Order for Premium Subscription
 * POST /api/payment/create-order
 * Protected route
 */
exports.createOrder = async (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({
        message: 'Razorpay is not configured on server',
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.plan === 'premium') {
      // Check if subscription is still active
      if (user.subscriptionStatus === 'active' && user.subscriptionEndDate > new Date()) {
        return res.status(400).json({
          message: 'You already have an active premium subscription',
          subscriptionEndDate: user.subscriptionEndDate,
        });
      }
    }

    // Amount should be in smaller denomination (paisa for INR). ₹149 = 14900 paisa.
    const amount = (SUBSCRIPTION_PLANS.premium.price) * 100;
    const currency = 'INR';
    // Razorpay receipt max length is 40 chars
    const receipt = `p_${user._id.toString().slice(-8)}_${Date.now().toString().slice(-10)}`;

    const options = {
      amount: amount,
      currency: currency,
      receipt: receipt,
      notes: {
        userId: user._id.toString(),
        userEmail: user.email,
        userName: user.name,
        planName: 'Premium Monthly',
      },
    };

    const order = await razorpay.orders.create(options);

    logger.info(`[PAYMENT] Order created for user ${user._id}: ${order.id}`);

    res.status(200).json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
      },
      planDetails: {
        name: SUBSCRIPTION_PLANS.premium.name,
        price: SUBSCRIPTION_PLANS.premium.price,
        interval: SUBSCRIPTION_PLANS.premium.interval,
        features: {
          maxFileSize: '5 GB',
          totalStorage: '50 GB',
          fileExpiry: '90 days',
          maxUploadsPerDay: SUBSCRIPTION_PLANS.premium.maxUploadPerDay,
        },
      },
    });
  } catch (error) {
    const razorpayError = error?.error || error || {};
    const errorDetails = {
      message:
        razorpayError.description ||
        razorpayError.message ||
        error?.message ||
        'Unknown Razorpay error',
      code: razorpayError.code || error?.code || null,
      field: razorpayError.field || null,
      statusCode: error?.statusCode || error?.status || null,
    };

    logger.error(`[PAYMENT] create-order failed: ${JSON.stringify(errorDetails)}`);
    res.status(500).json({
      message: 'Failed to create payment order',
      error: errorDetails.message,
      code: errorDetails.code,
      field: errorDetails.field,
    });
  }
};

/**
 * Verify the Razorpay Payment Signature and Upgrade User Plan
 * POST /api/payment/verify
 * Protected route
 */
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const userId = req.user._id;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Missing payment verification data' });
    }

    const duplicateVerify = await PaymentEvent.findOne({
      eventType: 'payment.verify',
      paymentId: razorpay_payment_id,
    });
    if (duplicateVerify) {
      const user = await User.findById(userId).select('name email plan subscriptionStatus subscriptionEndDate');
      return res.status(200).json({
        success: true,
        message: 'Payment already verified earlier',
        user: user
          ? {
              id: user._id,
              name: user.name,
              email: user.email,
              plan: user.plan,
              subscriptionStatus: user.subscriptionStatus,
              subscriptionEndDate: user.subscriptionEndDate,
            }
          : undefined,
      });
    }

    // Create the expected signature using HMAC SHA256
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      logger.warn(`[PAYMENT] Invalid signature for order ${razorpay_order_id}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature. Payment verification failed.',
      });
    }

    // Fetch payment details from Razorpay to double-check
    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    if (payment.status !== 'captured') {
      logger.warn(`[PAYMENT] Payment not captured: ${razorpay_payment_id}`);
      return res.status(400).json({
        success: false,
        message: 'Payment was not captured successfully',
      });
    }

    if (payment.order_id !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: 'Payment/order mismatch',
      });
    }

    const paymentUserId = payment?.notes?.userId;
    if (paymentUserId && paymentUserId !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Payment does not belong to this user',
      });
    }

    const applied = await applyPremiumForPayment({
      userId,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      source: 'verify-endpoint',
    });
    if (!applied.ok) {
      return res.status(applied.status || 500).json({ message: applied.message || 'Payment apply failed' });
    }
    const user = applied.user;

    await PaymentEvent.create({
      eventId: `verify:${razorpay_payment_id}`,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      userId,
      eventType: 'payment.verify',
      payloadHash: hashPayload({ razorpay_order_id, razorpay_payment_id }),
    });

    res.status(200).json({
      success: true,
      message: applied.alreadyActive
        ? 'Payment verified. Premium plan already active.'
        : 'Payment verified and plan upgraded successfully!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionEndDate: user.subscriptionEndDate,
      },
      planDetails: {
        name: SUBSCRIPTION_PLANS.premium.name,
        maxFileSize: '5 GB',
        totalStorage: '50 GB',
        fileExpiry: '90 days',
        features: SUBSCRIPTION_PLANS.premium,
      },
    });
  } catch (error) {
    logger.error('Error verifying Razorpay payment:', error);
    res.status(500).json({ message: 'Server error during payment verification', error: error.message });
  }
};

/**
 * Razorpay webhook handler (idempotent)
 * POST /api/payment/webhook
 */
exports.handleWebhook = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ message: 'Webhook secret not configured' });

    const bodyString = req.rawBody || JSON.stringify(req.body);
    const signature = req.headers['x-razorpay-signature'];
    const expected = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');

    if (!signature || signature !== expected) {
      return res.status(400).json({ message: 'Invalid webhook signature' });
    }

    const eventId = req.body?.payload?.payment?.entity?.id
      ? `${req.body.event}:${req.body.payload.payment.entity.id}`
      : `${req.body.event}:${req.body?.created_at || Date.now()}`;

    const existing = await PaymentEvent.findOne({ eventId });
    if (existing) {
      return res.status(200).json({ message: 'Event already processed' });
    }

    const eventType = req.body?.event;
    const paymentEntity = req.body?.payload?.payment?.entity;
    const orderEntity = req.body?.payload?.order?.entity;
    const notes = paymentEntity?.notes || orderEntity?.notes || {};

    let userId = notes.userId || null;
    const orderId = paymentEntity?.order_id || orderEntity?.id || null;
    const paymentId = paymentEntity?.id || null;

    if (eventType === 'payment.captured' && userId) {
      await applyPremiumForPayment({
        userId,
        orderId,
        paymentId,
        source: 'webhook',
      });
    }

    await PaymentEvent.create({
      eventId,
      paymentId,
      orderId,
      userId: userId || null,
      eventType,
      payloadHash: hashPayload(req.body),
    });

    return res.status(200).json({ message: 'Webhook processed' });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(200).json({ message: 'Event already processed' });
    }
    logger.error(`[PAYMENT] Webhook error: ${error.message}`);
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
};

/**
 * Get payment details and subscription status
 * GET /api/payment/status
 * Protected route
 */
exports.getSubscriptionStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const subscription = {
      plan: user.plan,
      status: user.subscriptionStatus,
      startDate: user.subscriptionStartDate,
      endDate: user.subscriptionEndDate,
      daysRemaining:
        user.subscriptionEndDate && user.plan === 'premium'
          ? Math.ceil((user.subscriptionEndDate - new Date()) / (1000 * 60 * 60 * 24))
          : null,
    };

    // Check if subscription has expired
    if (
      user.plan === 'premium' &&
      user.subscriptionEndDate &&
      user.subscriptionEndDate < new Date()
    ) {
      user.plan = 'free';
      user.subscriptionStatus = 'expired';
      await user.save();
      subscription.plan = 'free';
      subscription.status = 'expired';
    }

    res.status(200).json({
      success: true,
      subscription,
      planDetails: SUBSCRIPTION_PLANS[user.plan],
    });
  } catch (error) {
    logger.error('Error fetching subscription status:', error);
    res.status(500).json({ message: 'Error fetching subscription status', error: error.message });
  }
};

/**
 * Get all available subscription plans
 * GET /api/payment/plans
 * Public route
 */
exports.getSubscriptionPlans = async (req, res) => {
  try {
    const plans = [];

    for (const [key, plan] of Object.entries(SUBSCRIPTION_PLANS)) {
      plans.push({
        id: key,
        name: plan.name,
        price: plan.price || 0,
        interval: plan.interval || 'lifetime',
        features: {
          maxFileSize: `${plan.maxFileSize / (1024 * 1024 * 1024)}GB`,
          totalStorage: `${plan.totalStorage / (1024 * 1024 * 1024)}GB`,
          fileExpiry: `${plan.fileExpiry} ${plan.fileExpiry > 1 ? 'hours' : 'hours'}`,
          maxUploadsPerDay: plan.maxUploadPerDay,
        },
      });
    }

    res.status(200).json({
      success: true,
      plans,
    });
  } catch (error) {
    logger.error('Error fetching subscription plans:', error);
    res.status(500).json({ message: 'Error fetching subscription plans', error: error.message });
  }
};

/**
 * Cancel subscription
 * POST /api/payment/cancel
 * Protected route
 */
exports.cancelSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.plan !== 'premium') {
      return res.status(400).json({ message: 'You do not have an active premium subscription' });
    }

    user.plan = 'free';
    user.subscriptionStatus = 'cancelled';
    user.subscriptionEndDate = new Date();

    await user.save();

    logger.info(`[PAYMENT] User ${user._id} cancelled premium subscription`);

    res.status(200).json({
      success: true,
      message: 'Subscription cancelled successfully. Your plan has been downgraded to free.',
      user: {
        id: user._id,
        plan: user.plan,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (error) {
    logger.error('Error cancelling subscription:', error);
    res.status(500).json({ message: 'Error cancelling subscription', error: error.message });
  }
};
