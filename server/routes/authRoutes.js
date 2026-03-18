const express = require('express');
const { register, login, getMe, upgradeToPremium } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.post('/upgrade', protect, upgradeToPremium);

module.exports = router;
