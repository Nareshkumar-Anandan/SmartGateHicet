const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { logAudit } = require('../middleware/auditLogger');

async function getUsers(req, res, next) {
  try {
    const [users] = await pool.query(`
      SELECT id, email, full_name, role, phone, must_change_password, is_active, last_login_at, created_at
      FROM users
      ORDER BY role ASC, full_name ASC
    `);

    return res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
}

async function createUser(req, res, next) {
  try {
    const { email, full_name, role = 'WARDEN', phone } = req.body;

    if (!email || !full_name) {
      return res.status(400).json({ success: false, message: 'Email and full name are required.' });
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: `An account with email '${email}' already exists.` });
    }

    // Generate temporary password
    const tempPass = `Hicet#${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const hash = await bcrypt.hash(tempPass, 10);

    const [result] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone, must_change_password, is_active)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [email.trim().toLowerCase(), hash, full_name.trim(), role, phone || null]
    );

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: result.insertId,
      details: `Created new user ${full_name} (${email}) with role ${role}`,
      ipAddress: req.ip
    });

    return res.status(201).json({
      success: true,
      message: 'User account created successfully.',
      userId: result.insertId,
      email: email.trim().toLowerCase(),
      temporaryPassword: tempPass
    });
  } catch (error) {
    next(error);
  }
}

async function resetUserPassword(req, res, next) {
  try {
    const { id } = req.params;

    const [users] = await pool.query('SELECT id, email, full_name FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const tempPass = `Reset#${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const hash = await bcrypt.hash(tempPass, 10);

    await pool.query(
      'UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = NOW() WHERE id = ?',
      [hash, id]
    );

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'PASSWORD_RESET_ADMIN',
      entityType: 'USER',
      entityId: id,
      details: `Admin reset temporary password for ${users[0].email}`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: 'Password reset successfully.',
      email: users[0].email,
      temporaryPassword: tempPass
    });
  } catch (error) {
    next(error);
  }
}

async function toggleUserStatus(req, res, next) {
  try {
    const { id } = req.params;

    if (parseInt(id, 10) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own administrative account.' });
    }

    const [users] = await pool.query('SELECT is_active, email FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const newStatus = users[0].is_active ? 0 : 1;
    await pool.query('UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ?', [newStatus, id]);

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: newStatus ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      entityType: 'USER',
      entityId: id,
      details: `${newStatus ? 'Activated' : 'Deactivated'} user ${users[0].email}`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: `User is now ${newStatus ? 'Active' : 'Inactive'}.`,
      isActive: Boolean(newStatus)
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getUsers,
  createUser,
  resetUserPassword,
  toggleUserStatus
};
