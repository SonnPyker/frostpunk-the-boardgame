// Error boundary for one region of the app. A crash in a panel (a bad card text, a missing field, a WebGL failure)
// is contained: the region shows a small notice with a retry button and the rest of the game keeps running.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { tn } from '../../i18n';

export interface ErrorBoundaryProps {
  /** shown in the notice, e.g. "3D map" or "Society board" */
  name: string;
  children: ReactNode;
  /** 'inline' fills its parent, 'corner' is a small notice that does not cover the map */
  variant?: 'inline' | 'corner';
  /** replaces the default notice (receives the error and a reset function) */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** optional hook for the caller, e.g. to toast the message */
  onError?: (error: Error) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged, not rethrown: the rest of the app keeps running.
    console.error(`[${this.props.name}] crashed:`, error, info.componentStack);
    this.props.onError?.(error);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    const variant = this.props.variant ?? 'inline';
    return (
      <div className={`error-notice error-notice--${variant}`} role="alert">
        <div className="error-notice__title">{this.props.name} {tn('could not be drawn')}</div>
        <div className="error-notice__text">{error.message || tn('Unknown error')}</div>
        <button type="button" className="error-notice__retry" onClick={this.reset}>
          {tn('Reload panel')}
        </button>
      </div>
    );
  }
}
