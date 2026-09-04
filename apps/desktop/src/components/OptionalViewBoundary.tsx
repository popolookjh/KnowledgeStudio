import { Component, type ErrorInfo, type ReactNode } from 'react';

interface OptionalViewBoundaryProps {
  readonly name: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

interface OptionalViewBoundaryState {
  readonly failed: boolean;
}

/**
 * Keeps a failed optional lazy chunk isolated from the editor workbench.
 * Graph and Canvas remain dismissible/retryable rather than taking down the
 * whole renderer when a code-split resource cannot load.
 */
export class OptionalViewBoundary extends Component<OptionalViewBoundaryProps, OptionalViewBoundaryState> {
  override state: OptionalViewBoundaryState = { failed: false };

  static getDerivedStateFromError(): OptionalViewBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Errors are intentionally contained here; the app-level error/logging
    // boundary can observe them without rendering sensitive note data.
  }

  private retry = (): void => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <div className="optional-view-fallback" role="alert">
        <p>{this.props.name} could not be loaded.</p>
        <div className="optional-view-fallback__actions">
          <button type="button" className="btn btn--small btn--primary" onClick={this.retry}>
            Retry
          </button>
          <button type="button" className="btn btn--small" onClick={this.props.onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }
}
