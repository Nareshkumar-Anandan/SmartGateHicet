const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { JWT_SECRET } = require('../middleware/auth');
const { logAudit } = require('../middleware/auditLogger');

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.'
      });
    }

    const [users] = await pool.query(
      'SELECT id, email, password_hash, full_name, role, phone, must_change_password, is_active FROM users WHERE email = ?',
      [email.trim().toLowerCase()]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. User not found.'
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact the administrator.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      await logAudit({
        userId: user.id,
        actorName: user.full_name,
        actorRole: user.role,
        action: 'LOGIN_FAILED',
        entityType: 'AUTH',
        entityId: user.id,
        details: 'Incorrect password attempt',
        ipAddress: req.ip
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Incorrect password.'
      });
    }

    // Update last login
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    // Sign JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    await logAudit({
      userId: user.id,
      actorName: user.full_name,
      actorRole: user.role,
      action: 'LOGIN_SUCCESS',
      entityType: 'AUTH',
      entityId: user.id,
      details: `User logged in from ${req.ip}`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        phone: user.phone,
        mustChangePassword: Boolean(user.must_change_password)
      }
    });
  } catch (error) {
    next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Old password and new password are required.'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long.'
      });
    }

    const [users] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(oldPassword, users[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password does not match.'
      });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = NOW() WHERE id = ?',
      [newHash, userId]
    );

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'PASSWORD_CHANGED',
      entityType: 'USER',
      entityId: userId,
      details: 'User successfully updated password (must_change_password reset to 0)',
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: 'Password successfully updated. You may now continue using the system.'
    });
  } catch (error) {
    next(error);
  }
}

async function getProfile(req, res, next) {
  try {
    return res.json({
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.full_name,
        role: req.user.role,
        phone: req.user.phone,
        mustChangePassword: Boolean(req.user.must_change_password)
      }
    });
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    if (req.user) {
      await logAudit({
        userId: req.user.id,
        actorName: req.user.full_name,
        actorRole: req.user.role,
        action: 'LOGOUT',
        entityType: 'AUTH',
        entityId: req.user.id,
        details: 'User logged out',
        ipAddress: req.ip
      });
    }
    return res.json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  login,
  changePassword,
  getProfile,
  logout
};
