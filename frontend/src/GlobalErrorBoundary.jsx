import React from 'react';

export class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // You can log error info here if needed
    // console.error('Global error boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: '#ef4444', background: '#0f172a', minHeight: '100vh', fontFamily: 'sans-serif' }}>
          <h1 style={{ fontSize: 28, marginBottom: 16 }}>Something went wrong</h1>
          <div style={{ fontSize: 16, marginBottom: 12 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <pre style={{ color: '#fca5a5', background: '#1e293b', padding: 16, borderRadius: 8, overflowX: 'auto' }}>
            {this.state.error?.stack}
          </pre>
          <div style={{ marginTop: 24, color: '#64748b', fontSize: 14 }}>
            Please reload the page or contact support if this persists.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
