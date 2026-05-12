import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
  /** "go-back" navigates back, "return-home" goes to /, "inline" renders in-place */
  action?: 'go-back' | 'return-home' | 'inline';
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo);
    // If a dynamically imported chunk fails to load (stale cache after update),
    // force a full page reload to pick up the new assets.
    if (error?.message?.includes('dynamically imported module') || error?.message?.includes('Failed to fetch')) {
      window.location.reload();
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleAction = () => {
    const { action } = this.props;
    this.setState({ hasError: false, error: null });
    if (action === 'go-back') {
      window.history.back();
    } else if (action === 'return-home') {
      window.location.href = '/';
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    const { action = 'inline' } = this.props;
    const isPage = action === 'go-back' || action === 'return-home';

    if (isPage) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="solid-surface rounded-[28px] bg-white/6 p-8 backdrop-blur">
             <h2 className="mb-2 text-xl font-semibold text-white">Something went wrong</h2>
            <p className="mb-4 text-sm text-white/60">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            {this.state.error?.stack ? (
              <pre className="mb-4 max-h-32 overflow-auto rounded bg-black/40 p-2 text-left text-xs text-white/40">
                {this.state.error.stack}
              </pre>
            ) : null}
            <div className="flex justify-center gap-3">
              <button
                onClick={this.handleAction}
                className="rounded-full bg-[var(--bliss-teal)] px-5 py-2 text-sm font-medium text-black transition hover:opacity-90"
              >
                {action === 'go-back' ? 'Go Back' : 'Return Home'}
              </button>
              <button
                onClick={this.handleReset}
                className="rounded-full bg-white/10 px-5 py-2 text-sm font-medium text-white transition hover:bg-white/20"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Inline fallback for rows
    return (
      <div className="solid-surface my-2 rounded-[28px] bg-white/6 p-4 backdrop-blur">
        <p className="text-sm text-white/60">Failed to load this section.</p>
        <button
          onClick={this.handleReset}
          className="mt-2 text-xs text-[var(--bliss-teal)] hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }
}

/** Inline fallback for home page rows */
export function ErrorRow() {
  return (
    <div className="solid-surface my-2 rounded-[28px] bg-white/6 p-4 backdrop-blur">
      <p className="text-sm text-white/60">Failed to load this section.</p>
    </div>
  );
}

/** Full-page fallback */
export function ErrorPage({ action = 'return-home', error }: { action?: 'go-back' | 'return-home'; error?: Error | null }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="solid-surface rounded-[28px] bg-white/6 p-8 backdrop-blur">
        <h2 className="mb-2 text-xl font-semibold text-white">Something went wrong</h2>
        <p className="mb-4 text-sm text-white/60">{error?.message ?? 'An unexpected error occurred.'}</p>
        {error?.stack ? (
          <pre className="mb-4 max-h-32 overflow-auto rounded bg-black/40 p-2 text-left text-xs text-white/40">
            {error.stack}
          </pre>
        ) : null}
        <button
          onClick={() => {
            if (action === 'go-back') window.history.back();
            else window.location.href = '/';
          }}
          className="rounded-full bg-[var(--bliss-teal)] px-5 py-2 text-sm font-medium text-black transition hover:opacity-90"
        >
          {action === 'go-back' ? 'Go Back' : 'Return Home'}
        </button>
      </div>
    </div>
  );
}
