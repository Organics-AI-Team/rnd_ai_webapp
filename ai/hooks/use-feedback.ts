'use client';

import { useState, useCallback, useEffect } from 'react';
import { Feedback } from '../types/feedback-types';
import { IAIService } from '../services/core/ai-service-interface';

export interface UseFeedbackOptions {
  service?: IAIService;
  userId: string;
  serviceName?: string; // Service name for isolated learning
  autoSave?: boolean;
  onFeedbackSubmit?: (feedback: Feedback) => void;
  onError?: (error: Error) => void;
}

export interface UseFeedbackReturn {
  feedback: Feedback[];
  isSubmitting: boolean;
  error: Error | null;
  submitFeedback: (feedback: Omit<Feedback, 'id' | 'timestamp'>) => Promise<void>;
  getFeedbackHistory: (responseId?: string) => Feedback[];
  clearFeedback: () => void;
  getAverageScore: (responseId?: string) => number;
  getFeedbackStats: () => {
    total: number;
    averageScore: number;
    byType: Record<string, number>;
    recentScore: number;
  };
}

/**
 * Hook for managing feedback collection and analysis
 * Integrates with AI services to provide feedback-based learning
 */
export function useFeedback(options: UseFeedbackOptions): UseFeedbackReturn {
  const {
    service,
    userId,
    serviceName,
    autoSave = true,
    onFeedbackSubmit,
    onError
  } = options;

  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Load feedback from localStorage on mount (scoped by serviceName)
  useEffect(() => {
    try {
      const storageKey = serviceName ? `feedback_${userId}_${serviceName}` : `feedback_${userId}`;
      const stored = localStorage.getItem(storageKey);
      console.log('📂 [use-feedback] Loading feedback from:', storageKey);
      if (stored) {
        const parsedFeedback = JSON.parse(stored).map((fb: any) => ({
          ...fb,
          timestamp: new Date(fb.timestamp)
        }));
        setFeedback(parsedFeedback);
        console.log('✅ [use-feedback] Loaded', parsedFeedback.length, 'feedback items');
      }
    } catch (err) {
      console.warn('⚠️ [use-feedback] Failed to load feedback from localStorage:', err);
    }
  }, [userId, serviceName]);

  // Save feedback to localStorage when it changes (scoped by serviceName)
  useEffect(() => {
    if (autoSave && feedback.length > 0) {
      try {
        const storageKey = serviceName ? `feedback_${userId}_${serviceName}` : `feedback_${userId}`;
        localStorage.setItem(storageKey, JSON.stringify(feedback));
        console.log('💾 [use-feedback] Saved', feedback.length, 'feedback items to:', storageKey);
      } catch (err) {
        console.warn('⚠️ [use-feedback] Failed to save feedback to localStorage:', err);
      }
    }
  }, [feedback, userId, serviceName, autoSave]);

  const generateFeedbackId = () => `fb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const submitFeedback = useCallback(async (feedbackData: Omit<Feedback, 'id' | 'timestamp'>) => {
    if (!feedbackData.responseId || !feedbackData.userId) {
      const error = new Error('Missing required feedback fields: responseId and userId');
      setError(error);
      onError?.(error);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const newFeedback: Feedback = {
        ...feedbackData,
        id: generateFeedbackId(),
        timestamp: new Date(),
        processed: false,
        service_name: serviceName // Include service name for isolated learning
      };

      console.log('📝 [use-feedback] Submitting feedback:', {
        serviceName,
        type: newFeedback.type,
        score: newFeedback.score
      });

      // Add to local state
      setFeedback(prev => [...prev, newFeedback]);

      // Submit to AI service if available
      if (service) {
        service.addFeedback(newFeedback);
      }

      onFeedbackSubmit?.(newFeedback);

    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
    } finally {
      setIsSubmitting(false);
    }
  }, [service, onFeedbackSubmit, onError]);

  const getFeedbackHistory = useCallback((responseId?: string) => {
    if (responseId) {
      return feedback.filter(fb => fb.responseId === responseId);
    }
    return feedback;
  }, [feedback]);

  const clearFeedback = useCallback(() => {
    setFeedback([]);
    try {
      const storageKey = serviceName ? `feedback_${userId}_${serviceName}` : `feedback_${userId}`;
      localStorage.removeItem(storageKey);
      console.log('🗑️ [use-feedback] Cleared feedback from:', storageKey);
    } catch (err) {
      console.warn('⚠️ [use-feedback] Failed to clear feedback from localStorage:', err);
    }
  }, [userId, serviceName]);

  const getAverageScore = useCallback((responseId?: string) => {
    const relevantFeedback = getFeedbackHistory(responseId);
    if (relevantFeedback.length === 0) return 0;

    const total = relevantFeedback.reduce((sum, fb) => sum + fb.score, 0);
    return total / relevantFeedback.length;
  }, [getFeedbackHistory]);

  const getFeedbackStats = useCallback(() => {
    const total = feedback.length;
    const averageScore = total > 0
      ? feedback.reduce((sum, fb) => sum + fb.score, 0) / total
      : 0;

    const byType = feedback.reduce((acc, fb) => {
      acc[fb.type] = (acc[fb.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Recent score (last 10 feedback entries)
    const recentFeedback = feedback.slice(-10);
    const recentScore = recentFeedback.length > 0
      ? recentFeedback.reduce((sum, fb) => sum + fb.score, 0) / recentFeedback.length
      : 0;

    return {
      total,
      averageScore,
      byType,
      recentScore
    };
  }, [feedback]);

  return {
    feedback,
    isSubmitting,
    error,
    submitFeedback,
    getFeedbackHistory,
    clearFeedback,
    getAverageScore,
    getFeedbackStats
  };
}