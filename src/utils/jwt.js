const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { config } = require('../config/env');

// Generate JWT token
const generateToken = (payload) => {
  return jwt.sign(payload, config.jwt.secret, {
    jwtid: crypto.randomUUID(),
    expiresIn: config.jwt.expiresIn
  });
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

module.exports = {
  generateToken,
  verifyToken
};
