import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error("ErrorBoundary caught", error, info);
  }

  handleReload = (): void => {
    try {
      sessionStorage.removeItem("agent-builder-state-v5");
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="h-screen w-full flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-md w-full space-y-4 text-center">
            <div className="text-2xl font-semibold">Something went wrong</div>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">
              {this.state.error.message || "Unexpected render error."}
            </div>
            <Button onClick={this.handleReload} className="mt-2">
              Reload and start fresh
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
