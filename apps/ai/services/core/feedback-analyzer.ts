import { Feedback } from '../../types/feedback-types';
import { UserPreferences, FeedbackPatterns } from '../../types/ai-types';

/**
 * Shared feedback analysis logic used across all AI services
 */
export class FeedbackAnalyzer {
  /**
   * Analyzes feedback patterns to extract insights
   */
  static analyzeFeedbackPatterns(feedback: Feedback[]): FeedbackPatterns {
    if (feedback.length === 0) {
      return {
        averageScore: 0,
        commonIssues: [],
        preferredLength: 'medium',
        preferredComplexity: 'moderate',
        totalFeedback: 0
      };
    }

    const recentFeedback = feedback.slice(-20); // Last 20 pieces of feedback
    const averageScore = recentFeedback.reduce((sum, f) => sum + f.score, 0) / recentFeedback.length;

    // Get most common issues
    const typeCounts = recentFeedback.reduce((acc, f) => {
      if (f.type !== 'helpful' && f.type !== 'excellent') {
        acc[f.type] = (acc[f.type] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const commonIssues = Object.entries(typeCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([type]) => type);

    // Infer preferences from feedback
    const preferredLength = this.inferPreferredLength(recentFeedback);
    const preferredComplexity = this.inferPreferredComplexity(recentFeedback);

    return {
      averageScore,
      commonIssues,
      preferredLength,
      preferredComplexity,
      totalFeedback: feedback.length
    };
  }

  /**
   * Adjusts AI model parameters based on feedback patterns
   */
  static adjustParametersBasedOnFeedback(
    feedback: Feedback[],
    preferences: UserPreferences,
    baseParams: {
      temperature: number;
      maxTokens: number;
      presencePenalty?: number;
      frequencyPenalty?: number;
    }
  ) {
    const feedbackPatterns = this.analyzeFeedbackPatterns(feedback);
    const recentFeedback = feedback.slice(-10);

    const adjustments = { ...baseParams };

    // Adjust for length feedback
    const tooLongFeedback = recentFeedback.filter(f => f.type === 'too_long').length;
    const tooShortFeedback = recentFeedback.filter(f => f.type === 'too_short').length;

    if (tooLongFeedback > tooShortFeedback) {
      adjustments.maxTokens = Math.max(200, baseParams.maxTokens - 100);
    } else if (tooShortFeedback > tooLongFeedback) {
      adjustments.maxTokens = Math.min(1000, baseParams.maxTokens + 100);
    }

    // Adjust for complexity/unclear feedback
    const unclearFeedback = recentFeedback.filter(f => f.type === 'unclear').length;
    if (unclearFeedback > recentFeedback.length * 0.3) {
      adjustments.temperature = Math.max(0.3, baseParams.temperature - 0.2);
    }

    // Adjust for repetition
    const avgScore = recentFeedback.reduce((sum, f) => sum + f.score, 0) / recentFeedback.length;
    if (avgScore < 3 && baseParams.frequencyPenalty !== undefined) {
      adjustments.frequencyPenalty = Math.min(0.5, baseParams.frequencyPenalty + 0.2);
    }

    // Apply user preferences
    adjustments.maxTokens = this.getMaxTokensForLength(
      preferences.preferredLength,
      adjustments.maxTokens
    );

    // Adjust temperature based on complexity preference
    if (preferences.preferredComplexity === 'simple') {
      adjustments.temperature = Math.max(0.3, adjustments.temperature - 0.1);
    } else if (preferences.preferredComplexity === 'complex') {
      adjustments.temperature = Math.min(0.9, adjustments.temperature + 0.1);
    }

    return {
      ...adjustments,
      feedbackPatterns
    };
  }

  /**
   * Generates feedback instructions for AI prompts
   */
  static generateFeedbackInstructions(feedbackPatterns: FeedbackPatterns): string {
    let instructions = "";

    if (feedbackPatterns.totalFeedback > 0) {
      instructions += "Based on previous feedback:\n";

      // Length adjustments
      if (feedbackPatterns.commonIssues.includes('too_long')) {
        instructions += "- Keep responses concise and to the point\n";
      } else if (feedbackPatterns.commonIssues.includes('too_short')) {
        instructions += "- Provide more detailed and comprehensive responses\n";
      }

      // Clarity adjustments
      if (feedbackPatterns.commonIssues.includes('unclear')) {
        instructions += "- Use clear, simple language and well-structured responses\n";
      }

      // Accuracy focus
      if (feedbackPatterns.commonIssues.includes('inaccurate')) {
        instructions += "- Double-check facts and ensure information accuracy\n";
      }

      // Relevance focus
      if (feedbackPatterns.commonIssues.includes('not_related')) {
        instructions += "- Ensure responses directly address the user's question\n";
      }

      // If average score is low, emphasize quality
      if (feedbackPatterns.averageScore < 3.5) {
        instructions += "- Focus on providing high-quality, helpful responses\n";
      }
    }

    return instructions || "No specific feedback patterns to address.";
  }

  /**
   * Generates recommendations based on feedback patterns
   */
  static generateRecommendations(feedbackPatterns: FeedbackPatterns): string[] {
    const recommendations = [];

    if (feedbackPatterns.averageScore < 3.5) {
      recommendations.push("Focus on improving response quality based on user feedback");
    }

    if (feedbackPatterns.commonIssues.includes('too_long')) {
      recommendations.push("Consider providing more concise responses");
    }

    if (feedbackPatterns.commonIssues.includes('unclear')) {
      recommendations.push("Work on making responses clearer and more structured");
    }

    if (feedbackPatterns.totalFeedback > 10 && feedbackPatterns.averageScore > 4.0) {
      recommendations.push("Excellent performance! Current approach is working well");
    }

    return recommendations;
  }

  /**
   * Infers preferred response length from feedback
   */
  private static inferPreferredLength(feedback: Feedback[]): 'short' | 'medium' | 'long' {
    const tooLong = feedback.filter(f => f.type === 'too_long').length;
    const tooShort = feedback.filter(f => f.type === 'too_short').length;

    if (tooLong > tooShort * 1.5) return 'short';
    if (tooShort > tooLong * 1.5) return 'long';
    return 'medium';
  }

  /**
   * Infers preferred complexity from feedback
   */
  private static inferPreferredComplexity(feedback: Feedback[]): 'simple' | 'moderate' | 'complex' {
    const unclear = feedback.filter(f => f.type === 'unclear').length;
    const excellent = feedback.filter(f => f.type === 'excellent').length;

    if (unclear > excellent * 1.5) return 'simple';
    if (excellent > unclear * 1.5) return 'complex';
    return 'moderate';
  }

  /**
   * Gets max tokens based on preferred length
   */
  private static getMaxTokensForLength(preferredLength: string, baseMaxTokens: number = 500): number {
    switch (preferredLength) {
      case 'short':
        return Math.min(300, baseMaxTokens);
      case 'long':
        return Math.max(800, baseMaxTokens);
      default:
        return baseMaxTokens;
    }
  }
}