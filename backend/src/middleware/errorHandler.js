const config = require('../config/env');

function errorHandler(err, req, res, next) {
  const statusCode = err.status || err.statusCode || 500;
  const response = {
    error: {
      message: err.message || 'Internal Server Error',
    },
  };

  if (config.nodeEnv !== 'production' && err.stack) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = errorHandler;
