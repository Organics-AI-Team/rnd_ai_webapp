'use client';

import React, { useState } from 'react';
import { Star } from 'lucide-react';

interface FeedbackCollectorProps {
  responseId: string;
  aiResponse: string;
  prompt: string;
  model: string;
  onFeedbackSubmit: (feedback: {
    type: string;
    score: number;
    comment?: string;
  }) => void;
}

export function FeedbackCollector({
  responseId,
  aiResponse,
  prompt,
  model,
  onFeedbackSubmit
}: FeedbackCollectorProps) {
  const [currentRating, setCurrentRating] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleStarClick = async (rating: number) => {
    if (currentRating > 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      let feedbackType: string;
      if (rating === 5) {
        feedbackType = 'excellent';
      } else if (rating === 4) {
        feedbackType = 'helpful';
      } else if (rating === 3) {
        feedbackType = 'too_long';
      } else if (rating === 2) {
        feedbackType = 'not_related';
      } else {
        feedbackType = 'inaccurate';
      }

      await onFeedbackSubmit({
        type: feedbackType,
        score: rating,
        comment: ''
      });

      setCurrentRating(rating);
    } catch (error) {
      console.error('Error submitting feedback:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border-t border-gray-200 pt-2 mt-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-600 font-medium">ให้คะแนนคำตอบ:</span>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((rating) => (
            <button
              key={rating}
              onClick={() => handleStarClick(rating)}
              disabled={currentRating > 0 || isSubmitting}
              className={`transition-all duration-200 ${
                currentRating > 0
                  ? rating <= currentRating
                    ? 'text-yellow-400 cursor-default'
                    : 'text-gray-200 cursor-default'
                  : 'text-gray-300 hover:text-yellow-400 hover:scale-110 active:scale-95'
              }`}
              title={currentRating > 0 ? `ให้คะแนน ${currentRating} ดาว` : `ให้คะแนน ${rating} ดาว`}
            >
              <Star
                className="w-4 h-4"
                fill={currentRating > 0 && rating <= currentRating ? 'currentColor' : 'none'}
              />
            </button>
          ))}
          {currentRating > 0 && (
            <span className="text-xs text-green-600 ml-2 font-medium">ขอบคุณที่ให้คะแนน!</span>
          )}
          {isSubmitting && (
            <span className="text-xs text-blue-600 ml-2">กำลังส่ง...</span>
          )}
        </div>
      </div>
    </div>
  );
}