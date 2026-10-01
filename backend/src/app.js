const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const receiptRoutes = require('./routes/receipts');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Security and utility middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Foundational API routes
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/receipts', receiptRoutes);

// 404 handler for unrecognized routes
app.use((req, res, next) => {
  res.status(404).json({
    error: {
      message: `Not Found - ${req.originalUrl}`,
    },
  });
});

// Centralized error handling
app.use(errorHandler);

module.exports = app;
