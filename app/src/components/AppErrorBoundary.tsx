import React from "react";

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  errorMessage: string | null;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { errorMessage: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error("[NF] UI render failed", error, info.componentStack);
  }

  render() {
    if (this.state.errorMessage) {
      return (
        <div className="app app-error-shell" role="alert">
          <section className="app-error-card">
            <strong>NF hit a UI rendering problem.</strong>
            <p>The app stopped this view before it could blank the window. No project files were created.</p>
            <pre>{this.state.errorMessage}</pre>
            <button
              type="button"
              className="btn primary"
              onClick={() => this.setState({ errorMessage: null })}
            >
              Return to NF
            </button>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
