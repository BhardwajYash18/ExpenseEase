const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const receiptRoutes = require('./routes/receipts');
const financeBatchRoutes = require('./routes/financeBatches');
const journalEntryRoutes = require('./routes/journalEntries');
const accountMappingRoutes = require('./routes/accountMappings');
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
app.use('/api/finance-batches', financeBatchRoutes);
app.use('/api/journal-entries', journalEntryRoutes);
app.use('/api/account-mappings', accountMappingRoutes);


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
