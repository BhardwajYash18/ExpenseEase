const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/env');

/**
 * Local filesystem storage service for receipt files.
 *
 * This is a storage abstraction layer — the interface is designed so that
 * a future cloud/object storage implementation can replace this module
 * without modifying receipt business logic.
 *
 * SECURITY:
 * - Storage directory is outside frontend/public (never publicly served).
 * - Final storage path is entirely server-controlled.
 * - Original filenames are preserved only as database metadata, never used in paths.
 * - All storage keys are generated server-side using cryptographic randomness.
 * - Path traversal is prevented by construction (no user input in paths).
 */

/**
 * Ensure the storage directory exists.
 */
function ensureStorageDir() {
  const dir = config.receipt.storageDir;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate a unique, server-controlled storage key.
 * Format: <tenant_id>/<uuid>.<ext>
 *
 * The tenant_id prefix provides logical grouping but is NOT used for
 * access control — RLS and authentication enforce isolation.
 *
 * @param {string} tenantId - UUID of the tenant
 * @param {string} mimeType - Validated MIME type
 * @returns {string} opaque storage key
 */
function generateStorageKey(tenantId, mimeType) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const ext = extensions[mimeType] || 'bin';
  const uniqueId = crypto.randomUUID();
  return `${tenantId}/${uniqueId}.${ext}`;
}

/**
 * Safely resolve a storage path and prevent path traversal outside storageDir.
 *
 * @param {string} storageKey
 * @returns {string} canonical absolute path
 */
function resolveSafePath(storageKey) {
  if (!storageKey || typeof storageKey !== 'string') {
    const err = new Error('Invalid storage key: must be a non-empty string');
    err.status = 400;
    throw err;
  }
  const baseDir = path.resolve(config.receipt.storageDir);
  const targetPath = path.resolve(baseDir, storageKey);
  const normalizedBase = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;

  if (!targetPath.startsWith(normalizedBase)) {
    const err = new Error('Invalid storage key: path traversal detected');
    err.status = 400;
    throw err;
  }
  return targetPath;
}

/**
 * Store a file buffer to local filesystem.
 *
 * @param {string} storageKey - Server-generated storage key
 * @param {Buffer} fileBuffer - File content
 * @returns {Promise<{ storageKey: string, fullPath: string }>}
 */
async function storeFile(storageKey, fileBuffer) {
  ensureStorageDir();

  const fullPath = resolveSafePath(storageKey);
  const dir = path.dirname(fullPath);

  // Ensure tenant subdirectory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await fs.promises.writeFile(fullPath, fileBuffer);

  return { storageKey, fullPath };
}

/**
 * Read a file from local filesystem by storage key.
 *
 * @param {string} storageKey - Server-generated storage key
 * @returns {Promise<Buffer>} file content
 * @throws {Error} if file does not exist
 */
async function readFile(storageKey) {
  const fullPath = resolveSafePath(storageKey);
  return fs.promises.readFile(fullPath);
}

/**
 * Check if a file exists in storage.
 *
 * @param {string} storageKey - Server-generated storage key
 * @returns {boolean}
 */
function fileExists(storageKey) {
  try {
    const fullPath = resolveSafePath(storageKey);
    return fs.existsSync(fullPath);
  } catch (_) {
    return false;
  }
}

/**
 * Delete a file from storage.
 *
 * @param {string} storageKey - Server-generated storage key
 * @returns {Promise<void>}
 */
async function deleteFile(storageKey) {
  const fullPath = resolveSafePath(storageKey);
  if (fs.existsSync(fullPath)) {
    await fs.promises.unlink(fullPath);
  }
}

module.exports = {
  generateStorageKey,
  resolveSafePath,
  storeFile,
  readFile,
  fileExists,
  deleteFile,
  ensureStorageDir,
};
