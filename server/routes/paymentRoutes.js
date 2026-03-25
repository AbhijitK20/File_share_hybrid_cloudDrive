const express = require('express');
const {
  createOrder,
  verifyPayment,
  getSubscriptionStatus,
  getSubscriptionPlans,
  cancelSubscription,
  handleWebhook,
} = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Public routes
router.get('/plans', getSubscriptionPlans);
router.post('/webhook', handleWebhook);

// Protected routes - require authentication
router.post('/create-order', protect, createOrder);
router.post('/verify', protect, verifyPayment);
router.get('/status', protect, getSubscriptionStatus);
router.post('/cancel', protect, cancelSubscription);

module.exports = router;
