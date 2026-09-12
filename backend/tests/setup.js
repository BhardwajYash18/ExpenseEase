// Jest test environment setup
// Ensure required test environment variables are populated before application modules load
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'expensease_test_jwt_secret_for_automated_testing_suite_only';
