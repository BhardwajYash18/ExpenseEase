const config = require('../config/env');

function errorHandler(err, req, res, next) {
  let statusCode = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Map PostgreSQL syntax and input errors to HTTP 400
  if (err.code === '22P02') {
    statusCode = 400;
    message = 'Invalid identifier syntax or input format';
  } else if (err.code === '22001') {
    statusCode = 400;
    message = 'Input value exceeds maximum allowed length';
  } else if (err.code === '23505') {
    statusCode = 409;
    message = 'Resource conflict or duplicate entry';
  } else if (err.code === '23503') {
    statusCode = 400;
    message = 'Referenced resource does not exist';
  } else if (err.code === '22021') {
    statusCode = 400;
    message = 'Invalid characters or byte sequence in input';
  } else if (statusCode >= 500 && config.nodeEnv === 'production') {
    message = 'Internal Server Error';
  }

  const response = {
    error: {
      message,
    },
  };

  if (config.nodeEnv !== 'production' && err.stack && statusCode >= 500) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = errorHandler;

