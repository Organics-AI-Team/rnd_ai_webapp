/**
 * Utilities for analyzing AI responses
 */
export class ResponseAnalyzer {
  /**
   * Assesses the complexity of a response text
   */
  static assessComplexity(text: string): 'simple' | 'moderate' | 'complex' {
    const sentences = text.split('.').filter(s => s.trim().length > 0);
    const avgSentenceLength = sentences.reduce((sum, sentence) =>
      sum + sentence.split(' ').length, 0) / sentences.length;

    const technicalTerms = /algorithm|function|parameter|methodology|implementation|architecture|system|process|analysis/gi;
    const technicalDensity = (text.match(technicalTerms) || []).length / text.split(' ').length;

    // Complex indicators
    const complexIndicators = [
      text.includes('however') || text.includes('although') || text.includes('therefore'),
      text.split(',').length > 3,
      avgSentenceLength > 20
    ].filter(Boolean).length;

    if (avgSentenceLength > 20 || technicalDensity > 0.05 || complexIndicators >= 2) {
      return 'complex';
    } else if (avgSentenceLength > 15 || technicalDensity > 0.02 || complexIndicators >= 1) {
      return 'moderate';
    }
    return 'simple';
  }

  /**
   * Estimates token count for a given text
   */
  static estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Analyzes response quality metrics
   */
  static analyzeResponseQuality(text: string): {
    readability: number;
    technicalDensity: number;
    averageWordsPerSentence: number;
    totalSentences: number;
  } {
    const sentences = text.split('.').filter(s => s.trim().length > 0);
    const words = text.split(' ');
    const technicalTerms = /algorithm|function|parameter|methodology|implementation|architecture|system|process|analysis/gi;
    const technicalCount = (text.match(technicalTerms) || []).length;

    return {
      readability: this.calculateReadabilityScore(text),
      technicalDensity: technicalCount / words.length,
      averageWordsPerSentence: words.length / sentences.length,
      totalSentences: sentences.length
    };
  }

  /**
   * Calculates a simple readability score
   */
  private static calculateReadabilityScore(text: string): number {
    const sentences = text.split('.').filter(s => s.trim().length > 0);
    const words = text.split(' ');
    const syllables = this.countSyllables(text);

    // Simplified Flesch Reading Ease formula
    const avgWordsPerSentence = words.length / sentences.length;
    const avgSyllablesPerWord = syllables / words.length;

    const score = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Counts syllables in text (simplified approximation)
   */
  private static countSyllables(text: string): number {
    const words = text.toLowerCase().split(' ');
    let syllableCount = 0;

    words.forEach(word => {
      // Remove non-alphabetic characters
      word = word.replace(/[^a-z]/g, '');

      if (word.length === 0) return;

      // Simple syllable counting rules
      let syllables = 0;
      const vowels = 'aeiouy';

      // Count vowel groups
      let prevWasVowel = false;
      for (let i = 0; i < word.length; i++) {
        const isVowel = vowels.includes(word[i]);
        if (isVowel && !prevWasVowel) {
          syllables++;
        }
        prevWasVowel = isVowel;
      }

      // Adjust for silent e at the end
      if (word.endsWith('e') && syllables > 1) {
        syllables--;
      }

      // Ensure at least one syllable
      syllableCount += Math.max(1, syllables);
    });

    return syllableCount;
  }
}