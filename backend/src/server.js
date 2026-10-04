const app = require('./app');
const config = require('./config/env');
const { pool } = require('./config/db');

const server = app.listen(config.port, () => {
  console.log(`[ExpenseEase Backend] Running on port ${config.port} (${config.nodeEnv})`);
});

// Graceful shutdown handling
const handleShutdown = (signal) => {
  console.log(`[ExpenseEase Backend] Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('[ExpenseEase Backend] HTTP server closed.');
    pool.end(() => {
      console.log('[ExpenseEase Backend] PostgreSQL pool closed.');
      process.exit(0);
    });
  });
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
