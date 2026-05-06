const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs     = require('fs');
const path   = require('path');

const CONFIG_PATH = process.env.CONFIG_PATH
  || path.join(__dirname, 'config.json');

const JWT_SECRET = process.env.JWT_SECRET
  || 'change-this-secret-in-production';

function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    const defaultConfig = {
      passwordHash: bcrypt.hashSync('admin123', 10),
      mustChangePassword: true,
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
}

function verifyPassword(password) {
  const config = getConfig();
  return bcrypt.compareSync(password, config.passwordHash);
}

function generateToken() {
  return jwt.sign({ user: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function savePassword(newHash) {
  const config = getConfig();
  config.passwordHash = newHash;
  config.mustChangePassword = false;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function mustChangePassword() {
  return getConfig().mustChangePassword === true;
}

module.exports = {
  verifyPassword, generateToken, verifyToken,
  hashPassword, savePassword, mustChangePassword,
};
