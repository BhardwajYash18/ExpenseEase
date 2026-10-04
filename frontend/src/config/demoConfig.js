/**
 * Dedicated Development & Demo Accounts Configuration
 *
 * NOTE: These accounts and credentials are provided strictly for local development,
 * testing, and demonstration. They are enabled only in local development mode
 * (import.meta.env.DEV) or when VITE_ENABLE_DEMO is explicitly enabled.
 *
 * NEVER deploy or use these credentials in a production environment.
 */
export const IS_DEMO_MODE = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO === 'true';

export const DEMO_ACCOUNTS = {
  EMPLOYEE: {
    label: 'Employee',
    slug: 'demo',
    email: 'employee@expenseease.local',
    password: 'employee123',
    role: 'EMPLOYEE',
  },
  MANAGER: {
    label: 'Manager',
    slug: 'demo',
    email: 'manager@expenseease.local',
    password: 'manager123',
    role: 'MANAGER',
  },
  FINANCE: {
    label: 'Finance',
    slug: 'demo',
    email: 'finance@expenseease.local',
    password: 'finance123',
    role: 'FINANCE',
  },
};
