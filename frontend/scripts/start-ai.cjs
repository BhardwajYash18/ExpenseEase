#!/usr/bin/env node

/**
 * Cross-platform runner script to start the AI document processing service
 * using the project's existing virtual environment or system Python.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const aiDir = path.resolve(__dirname, '../../ai-service');

// Determine Python executable path: prefer .venv if present
const isWindows = process.platform === 'win32';
const venvPythonWin = path.join(aiDir, '.venv', 'Scripts', 'python.exe');
const venvPythonUnix = path.join(aiDir, '.venv', 'bin', 'python');

let pythonBin = 'python';

if (isWindows && fs.existsSync(venvPythonWin)) {
  pythonBin = venvPythonWin;
} else if (!isWindows && fs.existsSync(venvPythonUnix)) {
  pythonBin = venvPythonUnix;
} else if (process.env.PYTHON) {
  pythonBin = process.env.PYTHON;
} else if (!isWindows) {
  // On Unix, check if python3 exists
  pythonBin = 'python3';
}

console.log(`[AI-Service] Starting FastAPI document service using: ${pythonBin}`);
console.log(`[AI-Service] Working directory: ${aiDir}`);

const args = ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8000', '--reload'];

const child = spawn(pythonBin, args, {
  cwd: aiDir,
  stdio: 'inherit',
  shell: false,
});

child.on('error', (err) => {
  console.error(`[AI-Service] Failed to start Python process: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code || 0);
  }
});

// Forward termination signals to child process
process.on('SIGINT', () => {
  if (!child.killed) child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  if (!child.killed) child.kill('SIGTERM');
});
