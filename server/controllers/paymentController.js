const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User');
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

    // Payment is verified successfully, upgrade user's plan
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user subscription
    const subscriptionStartDate = new Date();
    const subscriptionEndDate = new Date();
    subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1); // 1 month subscription

    user.plan = 'premium';
    user.subscriptionId = razorpay_order_id;
    user.subscriptionStatus = 'active';
    user.subscriptionStartDate = subscriptionStartDate;
    user.subscriptionEndDate = subscriptionEndDate;

    await user.save();

    logger.info(`[PAYMENT] User ${userId} upgraded to premium. Subscription ends: ${subscriptionEndDate}`);

    res.status(200).json({
      success: true,
      message: 'Payment verified and plan upgraded successfully!',
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
