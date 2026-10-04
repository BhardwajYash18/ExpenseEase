const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env if present
dotenv.config();

// Fail fast if JWT_SECRET is not configured — no default or fallback is permitted
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
  throw new Error('[Config] FATAL: JWT_SECRET environment variable is required and must not be empty. No default fallback is permitted.');
}

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

// In production, DB_PASSWORD must be explicitly provided via environment configuration
if (isProduction && (!process.env.DB_PASSWORD || process.env.DB_PASSWORD.trim() === '')) {
  throw new Error('[Config] FATAL: DB_PASSWORD environment variable is required in production. No default fallback is permitted.');
}

// Dedicated development-only fallback password strictly isolated for local evaluation/testing
const DEV_ONLY_DB_PASSWORD = 'expensease_secure_password';

const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'expensease_db',
    user: process.env.DB_USER || 'expensease_user',
    password: process.env.DB_PASSWORD || (isProduction ? '' : DEV_ONLY_DB_PASSWORD),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8000',
  auth: {
    // JWT_SECRET is strictly required from environment. No fallback or default value.
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  receipt: {
    // Maximum receipt file size in bytes (configurable via environment; default 10 MB)
    maxFileSizeBytes: parseInt(process.env.MAX_RECEIPT_FILE_SIZE_MB || '10', 10) * 1024 * 1024,
    // Allowed MIME types for receipt uploads (JPEG, PNG, WebP — PDF deferred per CP3 scope)
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    // Local storage directory for uploaded receipts (not publicly served)
    storageDir: process.env.RECEIPT_STORAGE_DIR || path.join(__dirname, '..', '..', 'storage', 'receipts'),
  },
};

module.exports = config;
