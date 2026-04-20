const Razorpay = require('razorpay');
const crypto = require('crypto');
const supabase = require('../utils/supabase');
const { logger } = require('../utils/logger');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const SUBSCRIPTION_PLANS = {
  free: {
    name: 'Free Plan',
    maxFileSize: 100 * 1024 * 1024,
    totalStorage: 500 * 1024 * 1024,
  },
  premium: {
    name: 'Premium Plan',
    price: 149,
    interval: 'monthly',
  },
};

async function recordPayment({ userId, orderId, paymentId, amount, status, rawPayload }) {
  try {
    await supabase.from('payments').insert([
      {
        user_id: userId,
        provider: 'razorpay',
        order_id: orderId || null,
        payment_id: paymentId || null,
        amount: amount || null,
        currency: 'INR',
        status,
        raw_payload: rawPayload || {},
      },
    ]);
  } catch (error) {
    logger.warn(`[PAYMENT] failed to record payment event: ${error.message}`);
  }
}

async function applyPremiumForPayment({ userId, orderId, paymentId, source }) {
  const subscriptionEndDate = new Date();
  subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);

  const { data: user, error } = await supabase
    .from('users')
    .update({
      plan: 'premium',
      subscription_status: 'active',
      subscription_end_date: subscriptionEndDate.toISOString()
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) return { ok: false, message: error.message };

  await recordPayment({
    userId,
    orderId,
    paymentId,
    amount: SUBSCRIPTION_PLANS.premium.price * 100,
    status: 'paid',
    rawPayload: { source: source || 'verify' },
  });

  return { ok: true, user };
}

exports.getSubscriptionPlans = async (req, res) => {
  return res.json({ success: true, plans: SUBSCRIPTION_PLANS });
};

exports.createOrder = async (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({ message: 'Payment configuration missing on server' });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const amount = SUBSCRIPTION_PLANS.premium.price * 100;
    const options = {
      amount,
      currency: 'INR',
      receipt: `rcpt_${user.id.slice(0, 8)}`,
      notes: { userId: user.id }
    };

    const order = await razorpay.orders.create(options);

    await recordPayment({
      userId: user.id,
      orderId: order.id,
      paymentId: null,
      amount,
      status: 'created',
      rawPayload: order,
    });

    res.json({
      success: true,
      order,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    logger.error('Create order error:', error);
    res.status(500).json({ message: 'Order creation failed' });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (expected !== razorpay_signature) {
      await recordPayment({
        userId: req.user.id,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        amount: SUBSCRIPTION_PLANS.premium.price * 100,
        status: 'failed',
        rawPayload: req.body,
      });
      return res.status(400).json({ message: 'Invalid signature' });
    }

    const applied = await applyPremiumForPayment({
      userId: req.user.id,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      source: 'verify',
    });

    if (!applied.ok) return res.status(500).json({ message: applied.message });

    res.json({ success: true, user: applied.user });
  } catch (error) {
    logger.error('Verify payment error:', error);
    res.status(500).json({ message: 'Verification error' });
  }
};

exports.handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const payloadBuffer = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(JSON.stringify(req.body || {}));

    if (webhookSecret && signature) {
      const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(payloadBuffer)
        .digest('hex');

      if (expected !== signature) {
        return res.status(400).json({ message: 'Invalid webhook signature' });
      }
    }

    const event = req.body?.event;
    const paymentEntity = req.body?.payload?.payment?.entity;

    if (event === 'payment.captured' && paymentEntity) {
      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;
      const userId = paymentEntity.notes?.userId;

      if (userId) {
        await applyPremiumForPayment({
          userId,
          orderId,
          paymentId,
          source: 'webhook',
        });
      }
    }

    return res.json({ status: 'ok' });
  } catch (error) {
    logger.error('Webhook error:', error);
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
};

exports.getSubscriptionStatus = async (req, res) => {
  const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  return res.json({
    success: true,
    subscription: {
      plan: user.plan,
      status: user.subscription_status,
      endDate: user.subscription_end_date,
    },
  });
};

exports.cancelSubscription = async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .update({
        plan: 'free',
        subscription_status: 'canceled',
        subscription_end_date: null,
      })
      .eq('id', req.user.id)
      .select('*')
      .single();

    if (error || !user) {
      return res.status(500).json({ message: 'Failed to cancel subscription' });
    }

    await recordPayment({
      userId: user.id,
      orderId: null,
      paymentId: null,
      amount: null,
      status: 'canceled',
      rawPayload: { source: 'manual_cancel' },
    });

    return res.json({
      success: true,
      message: 'Subscription canceled successfully',
      subscription: {
        plan: user.plan,
        status: user.subscription_status,
        endDate: user.subscription_end_date,
      },
    });
  } catch (error) {
    logger.error('Cancel subscription error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
