import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Service Worker management: register only in production; unregister and clear caches in development
if ('serviceWorker' in navigator) {
  if (process.env.NODE_ENV === 'production') {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[ExpenseEase PWA] ServiceWorker registered with scope:', registration.scope);
        })
        .catch((error) => {
          console.warn('[ExpenseEase PWA] ServiceWorker registration failed:', error);
        });
    });
  } else {
    // In development mode, automatically unregister stale service workers and clear cache storage
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });
    if ('caches' in window) {
      caches.keys().then((keys) => {
        keys.forEach((key) => caches.delete(key));
      });
    }
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
