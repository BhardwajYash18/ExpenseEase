const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env if present
dotenv.config();

// Fail fast if JWT_SECRET is not configured — no default or fallback is permitted
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
  throw new Error('[Config] FATAL: JWT_SECRET environment variable is required and must not be empty. No default fallback is permitted.');
}

const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'expensease_db',
    user: process.env.DB_USER || 'expensease_user',
    password: process.env.DB_PASSWORD || 'expensease_secure_password',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8000',
  auth: {
    // JWT_SECRET is strictly required from environment. No fallback or default value.
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
};

module.exports = config;
