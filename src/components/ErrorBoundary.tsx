import React from 'react';

interface State {
  hasError: boolean;
  error: Error | null;
}

function isChunkLoadError(error: Error): boolean {
  const msg = error.message || '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Unable to preload') ||
    error.name === 'ChunkLoadError'
  );
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode; fallback?: React.ReactNode }, State> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (isChunkLoadError(error)) {
      // Auto-reload once after a new deployment invalidates old chunk hashes.
      // sessionStorage flag prevents an infinite reload loop if the server is actually down.
      const alreadyRetried = sessionStorage.getItem('chunk-reload-retry') === '1';
      if (!alreadyRetried) {
        sessionStorage.setItem('chunk-reload-retry', '1');
        window.location.reload();
        return;
      }
    }
    console.error('ErrorBoundary caught:', error, info);
  }

  componentDidUpdate() {
    // Clear the retry flag once the app renders successfully after a reload
    if (!this.state.hasError) {
      sessionStorage.removeItem('chunk-reload-retry');
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="text-4xl">⚠️</div>
          <div>
            <p className="text-sm font-semibold text-foreground">Une erreur est survenue</p>
            <p className="text-xs text-muted-foreground mt-1">{this.state.error?.message || 'Erreur inconnue'}</p>
          </div>
          <button
            onClick={() => { sessionStorage.removeItem('chunk-reload-retry'); window.location.reload(); }}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Recharger la page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
