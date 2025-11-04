"use client";

import { useState } from "react";

interface UseFormSubmissionOptions<T> {
  onSubmit: (data: T) => Promise<void>;
  onSuccess?: () => void;
  onError?: (error: any) => void;
  successMessage?: string;
  errorMessage?: string;
}

export function useFormSubmission<T>({
  onSubmit,
  onSuccess,
  onError,
  successMessage = "Operation completed successfully!",
  errorMessage = "Operation failed"
}: UseFormSubmissionOptions<T>) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent, data: T) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await onSubmit(data);
      onSuccess?.();
      // Only show alert in browser environment
      if (typeof window !== "undefined") {
        alert(successMessage);
      }
    } catch (err: any) {
      const errorMsg = err.message || errorMessage;
      setError(errorMsg);
      onError?.(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetError = () => setError("");

  return {
    handleSubmit,
    isSubmitting,
    error,
    setError,
    resetError
  };
}