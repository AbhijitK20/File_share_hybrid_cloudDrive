const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User');

/**
 * Initialize Razorpay instance with keys from environment variables
 */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create a new Razorpay Order for the Pro Subscription
 * POST /api/payment/create-order
 * Protected route
 */
exports.createOrder = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.plan === 'premium') {
      return res.status(400).json({ message: 'User is already on the premium plan' });
    }

    // Amount should be in smaller denomination (paisa for INR). ₹150 = 15000 paisa.
    const amount = 150 * 100;
    const currency = 'INR';

    const options = {
      amount: amount,
      currency: currency,
      receipt: `recept_${user._id.toString()}_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);

    res.status(200).json({
      success: true,
      order: order,
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ message: 'Failed to create payment order' });
  }
};

/**
 * Verify the Razorpay Payment Signature
 * POST /api/payment/verify
 * Protected route
 */
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const userId = req.user.id;

    // Create the expected signature using HMAC SHA256
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      // Payment is verified successfully, upgrade user's plan
      const user = await User.findById(userId);
      user.plan = 'premium';
      await user.save();

      res.status(200).json({
        success: true,
        message: 'Payment verified and plan upgraded successfully!',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          plan: user.plan,
        },
      });
    } else {
      // Signature mismatch
      res.status(400).json({
        success: false,
        message: 'Invalid payment signature. Payment failed.',
      });
    }
  } catch (error) {
    console.error('Error verifying Razorpay payment:', error);
    res.status(500).json({ message: 'Server error during payment verification' });
  }
};
