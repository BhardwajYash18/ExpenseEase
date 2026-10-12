import React from 'react';

/**
 * ErrorBoundary protects the application from catastrophic blank screens
 * when any unexpected runtime exception occurs in child view hierarchies.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ExpenseEase ErrorBoundary] Caught render error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ maxWidth: '640px', margin: '40px auto', width: '100%', padding: '0 16px' }}>
          <div className="table-card" style={{ padding: '32px', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>⚠️</div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Something went wrong loading this view
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
              The application encountered an unexpected issue while rendering this workspace.
              Tenant data and database state remain completely safe.
            </p>

            {this.state.error && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 16px',
                  marginBottom: '20px',
                  textAlign: 'left',
                  fontSize: '0.8rem',
                  fontFamily: 'monospace',
                  color: '#991b1b',
                  overflowX: 'auto',
                }}
              >
                {this.state.error.toString()}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => window.location.reload()}
              >
                🔄 Reload Page
              </button>
              <button
                type="button"
                className="btn btn-gold"
                onClick={this.handleReset}
              >
                🏠 Return to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
