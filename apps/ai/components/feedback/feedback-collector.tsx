'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ThumbsUp, ThumbsDown, Send, CheckCircle } from 'lucide-react';
import { Feedback, FeedbackType } from '../../types/feedback-types';
import { z } from 'zod';

export interface FeedbackCollectorProps {
  responseId: string;
  userId: string;
  aiResponse: string;
  aiModel: string;
  prompt: string;
  onSubmit: (feedback: Omit<Feedback, 'id' | 'timestamp'>) => Promise<void>;
  disabled?: boolean;
  showSubmitted?: boolean;
  className?: string;
}

const feedbackOptions: { type: z.infer<typeof FeedbackType>; label: string; icon: React.ReactNode }[] = [
  {
    type: 'excellent',
    label: 'Excellent',
    icon: <ThumbsUp className="w-4 h-4" />
  },
  {
    type: 'too_long',
    label: 'Too Long',
    icon: <span className="text-xs">📏</span>
  },
  {
    type: 'too_short',
    label: 'Too Short',
    icon: <span className="text-xs">📝</span>
  },
  {
    type: 'unclear',
    label: 'Unclear',
    icon: <span className="text-xs">❓</span>
  },
  {
    type: 'not_related',
    label: 'Not Related',
    icon: <span className="text-xs">🔗</span>
  },
  {
    type: 'inaccurate',
    label: 'Inaccurate',
    icon: <span className="text-xs">❌</span>
  }
];

/**
 * Component for collecting user feedback on AI responses
 * Provides multiple feedback types and optional comments
 */
export function FeedbackCollector({
  responseId,
  userId,
  aiResponse,
  aiModel,
  prompt,
  onSubmit,
  disabled = false,
  showSubmitted = false,
  className = ''
}: FeedbackCollectorProps) {
  const [selectedType, setSelectedType] = useState<z.infer<typeof FeedbackType> | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(showSubmitted);

  if (isSubmitted) {
    return (
      <div className={`flex items-center gap-2 text-green-600 text-sm ${className}`}>
        <CheckCircle className="w-4 h-4" />
        <span>Feedback submitted. Thank you!</span>
      </div>
    );
  }

  if (disabled) {
    return null;
  }

  const handleSubmit = async (feedbackType: z.infer<typeof FeedbackType>, score: number) => {
    setIsSubmitting(true);

    try {
      await onSubmit({
        responseId,
        userId,
        type: feedbackType,
        score,
        comment: comment.trim() || undefined,
        aiModel,
        prompt,
        aiResponse,
        context: {
          length: aiResponse.length,
          complexity: assessComplexity(aiResponse),
          category: 'general'
        },
        helpful: score >= 4,
        processed: false
      });

      setIsSubmitted(true);
      setSelectedType(null);
      setComment('');
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const assessComplexity = (text: string): 'simple' | 'moderate' | 'complex' => {
    const sentences = text.split('.').filter(s => s.trim().length > 0);
    const avgSentenceLength = sentences.reduce((sum, sentence) =>
      sum + sentence.split(' ').length, 0) / sentences.length;

    if (avgSentenceLength > 20) return 'complex';
    if (avgSentenceLength > 15) return 'moderate';
    return 'simple';
  };

  const getScoreForType = (type: z.infer<typeof FeedbackType>): number => {
    switch (type) {
      case 'excellent': return 5;
      case 'helpful': return 4;
      case 'too_long':
      case 'too_short':
      case 'unclear': return 3;
      case 'not_related': return 2;
      case 'not_helpful':
      case 'inaccurate': return 1;
      default: return 3;
    }
  };

  return (
    <Card className={`p-3 bg-slate-50 border-slate-200 ${className}`}>
      <div className="space-y-3">
        <div className="text-sm font-medium text-slate-700">
          Was this response helpful?
        </div>

        <div className="flex flex-wrap gap-2">
          {feedbackOptions.map((option) => (
            <Button
              key={option.type}
              variant={selectedType === option.type ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedType(option.type)}
              disabled={isSubmitting}
              className="flex items-center gap-1 h-8"
            >
              {option.icon}
              <span className="text-xs">{option.label}</span>
            </Button>
          ))}
        </div>

        {selectedType && (
          <div className="space-y-2">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Additional comments (optional)"
              className="min-h-[60px] text-sm resize-none"
              rows={2}
            />

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => handleSubmit(selectedType, getScoreForType(selectedType))}
                disabled={isSubmitting}
                className="flex items-center gap-1"
              >
                <Send className="w-3 h-3" />
                {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedType(null);
                  setComment('');
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}