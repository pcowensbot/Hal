import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.icon}>⚠</div>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.description}>
            HAL hit an unexpected error rendering this page. Your data is safe — reloading usually clears it.
          </p>
          <pre className={styles.details}>{error.message}</pre>
          <div className={styles.actions}>
            <Button variant="primary" onClick={this.handleReload}>Reload page</Button>
            <Button variant="secondary" onClick={this.handleReset}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }
}
