/**
 * Dedicated Development & Demo Accounts Configuration
 *
 * WARNING: DEVELOPMENT / DEMO ONLY - NEVER USE IN PRODUCTION.
 * These accounts are provided exclusively for local testing, evaluation, and demonstration.
 */

const DEMO_TENANT = {
  name: 'ExpensEase Demo',
  slug: 'demo',
  status: 'ACTIVE',
};

const DEMO_USERS = [
  // Primary demo accounts (@expenseease.local)
  {
    email: 'employee@expenseease.local',
    password: 'employee123',
    role: 'EMPLOYEE',
    firstName: 'Demo',
    lastName: 'Employee',
  },
  {
    email: 'manager@expenseease.local',
    password: 'manager123',
    role: 'MANAGER',
    firstName: 'Demo',
    lastName: 'Manager',
  },
  {
    email: 'finance@expenseease.local',
    password: 'finance123',
    role: 'FINANCE',
    firstName: 'Demo',
    lastName: 'Finance',
  },
  // Backward-compatible demo accounts (@demo.com)
  {
    email: 'employee@demo.com',
    password: 'employee123',
    role: 'EMPLOYEE',
    firstName: 'Demo',
    lastName: 'Employee',
  },
  {
    email: 'manager@demo.com',
    password: 'manager123',
    role: 'MANAGER',
    firstName: 'Demo',
    lastName: 'Manager',
  },
  {
    email: 'finance@demo.com',
    password: 'finance123',
    role: 'FINANCE',
    firstName: 'Demo',
    lastName: 'Finance',
  },
];

module.exports = {
  DEMO_TENANT,
  DEMO_USERS,
};
