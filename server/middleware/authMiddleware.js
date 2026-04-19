const jwt = require('jsonwebtoken');
const supabase = require('../utils/supabase');

/**
 * Protect routes — verify JWT token and attach user to request.
 */
const protect = async (req, res, next) => {
  try {
    let token;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized. No token provided.' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user to request (without password) from Supabase
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      return res.status(401).json({ message: 'Not authorized. User no longer exists.' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Not authorized. Invalid token.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Not authorized. Token expired.' });
    }
    res.status(500).json({ message: 'Server error during authentication' });
  }
};

/**
 * Optional auth — attaches user if token present but doesn't block if missing.
 */
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('id', decoded.id)
        .single();
      
      if (user) {
        req.user = user;
      }
    }

    next();
  } catch (error) {
    next();
  }
};

module.exports = { protect, optionalAuth };
