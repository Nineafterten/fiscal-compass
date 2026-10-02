import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
}

/**
 * Catches render errors so a bug in one screen doesn't leave a blank page.
 *
 * Styled with inline styles on purpose — the one place in the app where that's
 * correct, since a failure inside the Mantine provider can't rely on Mantine
 * rendering. Data is untouched: it's all in IndexedDB, so reloading recovers.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          maxWidth: 620,
          margin: '64px auto',
          padding: 24,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          lineHeight: 1.5,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Something broke on this screen</h2>
        <p>
          Your data is safe — everything lives in this browser&apos;s local storage and
          nothing was written by the failure. Reloading usually clears it.
        </p>
        <pre
          style={{
            background: 'rgba(127,127,127,0.12)',
            padding: 12,
            borderRadius: 8,
            overflowX: 'auto',
            fontSize: 12,
          }}
        >
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 16px',
            fontSize: 14,
            borderRadius: 8,
            border: '1px solid rgba(127,127,127,0.4)',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
