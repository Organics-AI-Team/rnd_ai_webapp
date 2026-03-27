import { Button } from "./button";
import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorDisplayProps {
  message: string;
  onRetry?: () => void;
  variant?: "default" | "inline";
}

export function ErrorDisplay({ message, onRetry, variant = "default" }: ErrorDisplayProps) {
  if (variant === "inline") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="flex-1">{message}</span>
        {onRetry && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className="h-auto p-1 text-red-600 hover:text-red-700 hover:bg-red-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-6 text-center">
      <div className="rounded-full bg-red-50 p-2.5 mb-3">
        <AlertCircle className="h-5 w-5 text-red-600" />
      </div>
      <h3 className="text-sm font-medium text-foreground mb-1">Error</h3>
      <p className="text-xs text-muted-foreground mb-3 max-w-md">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="sm">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      )}
    </div>
  );
}
