import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

// Catches render-time errors anywhere below it and shows a friendly, on-brand
// fallback instead of a blank white screen.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log for diagnostics; no secrets are involved here.
    console.error("Uncaught UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-error" role="alert">
          <div className="app-error-card">
            <h1>Something went wrong</h1>
            <p>
              The page hit an unexpected error. Refreshing usually fixes it. If
              it keeps happening, please let us know.
            </p>
            <button
              className="app-error-btn"
              onClick={() => window.location.reload()}
            >
              Reload the page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
