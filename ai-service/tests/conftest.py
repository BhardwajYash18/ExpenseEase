# tests/conftest.py
# Shared fixtures and pytest configuration for the AI service test suite.
# IMPORTANT: environment vars must be set BEFORE importing app modules that
# trigger the pydantic_settings Settings() singleton.

import os

# Pin AI to mock provider — no real LLM calls in tests
os.environ["AI_PROVIDER"] = "mock"
# Use a deterministic secret so JWT tokens generated in tests are verifiable
os.environ["JWT_SECRET"] = "test-secret-do-not-use-in-production"
os.environ["ENVIRONMENT"] = "test"
