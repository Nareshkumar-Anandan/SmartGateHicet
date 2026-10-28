const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'smartgate_hicet_super_secret_jwt_key_2026_secure';

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No authentication token provided.'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if user still exists and is active in database
    const [rows] = await pool.query(
      'SELECT id, email, full_name, role, must_change_password, is_active FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({
        success: false,
        message: 'User account is inactive or no longer exists.'
      });
    }

    req.user = rows[0];
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Authentication session expired. Please log in again.'
      });
    }
    return res.status(403).json({
      success: false,
      message: 'Invalid authentication token.'
    });
  }
}

module.exports = {
  authenticateToken,
  JWT_SECRET
};
