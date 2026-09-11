const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env if present
dotenv.config();

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
};

module.exports = config;
