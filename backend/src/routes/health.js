const express = require('express');
const http = require('http');
const https = require('https');
const { checkConnection } = require('../config/db');
const config = require('../config/env');

const router = express.Router();

/**
 * GET /api/health
 * Simple liveness check endpoint.
 */
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Helper to ping AI service /health with timeout
 */
function checkAiService(urlStr) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL('/health', urlStr);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const req = client.get(
        parsedUrl,
        { timeout: 2500 },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve({ ok: true, status: 'available' });
            } else {
              resolve({ ok: false, status: `HTTP ${res.statusCode}` });
            }
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 'timeout' });
      });
      req.on('error', (err) => {
        resolve({ ok: false, status: err.message });
      });
    } catch (err) {
      resolve({ ok: false, status: err.message });
    }
  });
}

/**
 * GET /api/health/ready
 * Readiness check verifying PostgreSQL and AI-service availability.
 * Does NOT create circular startup dependencies.
 */
router.get('/health/ready', async (req, res) => {
  const dbStatus = await checkConnection();
  const aiStatus = await checkAiService(config.aiServiceUrl);

  const isReady = dbStatus.ok && aiStatus.ok;

  const response = {
    status: isReady ? 'ready' : 'degraded',
    dependencies: {
      database: {
        status: dbStatus.ok ? 'connected' : 'unavailable',
        ...(dbStatus.error ? { error: dbStatus.error } : {}),
      },
      aiService: {
        status: aiStatus.ok ? 'available' : 'unavailable',
        ...(aiStatus.status ? { detail: aiStatus.status } : {}),
      },
    },
  };

  const statusCode = isReady ? 200 : 503;
  res.status(statusCode).json(response);
});

module.exports = router;
