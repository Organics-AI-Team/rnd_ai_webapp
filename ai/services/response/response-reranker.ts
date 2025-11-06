/**
 * AI Response Reranking Service
 * Applies Pinecone reranking to score and enhance AI responses
 */

import { Pinecone } from '@pinecone-database/pinecone';

interface ResponseScore {
  relevanceScore: number;      // How relevant to query (0-1)
  factualAccuracy: number;     // How factually accurate (0-1)
  userRelevance: number;       // Matches user preferences (0-1)
  overallScore: number;        // Combined score (0-1)
  sources: string[];           // Found sources
  confidence: number;          // Confidence in scoring (0-1)
}

interface ScoringOptions {
  enableFactCheck?: boolean;
  enablePersonalization?: boolean;
  weightRelevance?: number;
  weightAccuracy?: number;
  weightPersonalization?: number;
  userPreferences?: any;
}

/**
 * Service for scoring and reranking AI responses
 */
export class ResponseReranker {
  private pinecone: Pinecone;
  private rerankModel = 'bge-reranker-v2-m3';

  constructor(pineconeApiKey: string) {
    this.pinecone = new Pinecone({ apiKey: pineconeApiKey });
  }

  /**
   * Score AI response quality using multiple factors
   */
  async scoreResponse(
    query: string,
    response: string,
    searchResults: any[] = [],
    options: ScoringOptions = {}
  ): Promise<ResponseScore> {
    const {
      enableFactCheck = true,
      enablePersonalization = true,
      weightRelevance = 0.4,
      weightAccuracy = 0.3,
      weightPersonalization = 0.2,
      userPreferences = null
    } = options;

    console.log('🎯 [ResponseReranker] Scoring response quality...');

    try {
      // 1. Relevance Scoring using Pinecone reranking
      const relevanceScore = await this.calculateRelevanceScore(
        query,
        response,
        searchResults
      );

      // 2. Factual Accuracy Scoring
      const factualAccuracy = enableFactCheck
        ? await this.calculateFactualAccuracy(response, searchResults)
        : 0.8; // Default good score

      // 3. User Relevance Scoring
      const userRelevance = enablePersonalization && userPreferences
        ? await this.calculateUserRelevance(response, userPreferences)
        : 0.8; // Default good score

      // 4. Source Detection
      const sources = await this.extractSources(response, searchResults);

      // 5. Calculate Overall Score
      const overallScore = (
        relevanceScore * weightRelevance +
        factualAccuracy * weightAccuracy +
        userRelevance * weightPersonalization +
        (sources.length > 0 ? 0.1 : 0) // Bonus for having sources
      );

      const result: ResponseScore = {
        relevanceScore,
        factualAccuracy,
        userRelevance,
        overallScore: Math.min(overallScore, 1.0),
        sources,
        confidence: this.calculateConfidence(relevanceScore, factualAccuracy, userRelevance)
      };

      console.log('✅ [ResponseReranker] Response scored:', {
        overall: result.overallScore.toFixed(3),
        relevance: relevanceScore.toFixed(3),
        accuracy: factualAccuracy.toFixed(3),
        personal: userRelevance.toFixed(3),
        sources: sources.length
      });

      return result;

    } catch (error) {
      console.error('❌ [ResponseReranker] Scoring failed:', error);
      // Return default scores on error
      return {
        relevanceScore: 0.7,
        factualAccuracy: 0.8,
        userRelevance: 0.8,
        overallScore: 0.75,
        sources: [],
        confidence: 0.5
      };
    }
  }

  /**
   * Calculate relevance score using Pinecone reranking
   */
  private async calculateRelevanceScore(
    query: string,
    response: string,
    searchResults: any[]
  ): Promise<number> {
    try {
      // Prepare documents for reranking
      const documents = [
        { id: 'response', text: response },
        ...searchResults.map((result, index) => ({
          id: `result_${index}`,
          text: result.content || result.text || '',
        }))
      ];

      // Use Pinecone reranking to compare response with search results
      const rerankResponse = await this.pinecone.inference.rerank(
        this.rerankModel,
        query,
        documents,
        {
          topN: Math.min(documents.length, 10),
          returnDocuments: false,
          parameters: {
            inputType: 'passage',
            truncate: 'END'
          }
        }
      );

      // Find where our response ranks
      const responseRank = rerankResponse.data?.find((r: any) => r.id === 'response');

      if (responseRank) {
        // Normalize score to 0-1 range
        return Math.min(responseRank.score, 1.0);
      }

      // Fallback: if response not found, return moderate score
      return 0.7;

    } catch (error) {
      console.warn('⚠️ [ResponseReranker] Relevance scoring failed:', error);
      return 0.7; // Default moderate score
    }
  }

  /**
   * Calculate factual accuracy by checking against search results
   */
  private async calculateFactualAccuracy(response: string, searchResults: any[]): Promise<number> {
    if (searchResults.length === 0) return 0.8; // Default good score if no results

    try {
      // Extract key facts from response
      const responseFacts = this.extractFacts(response);

      // Check facts against search results
      let verifiedFacts = 0;
      for (const fact of responseFacts) {
        const isVerified = searchResults.some(result =>
          this.factMatchesSearch(fact, result)
        );
        if (isVerified) verifiedFacts++;
      }

      // Calculate accuracy based on verified facts
      const accuracy = responseFacts.length > 0
        ? verifiedFacts / responseFacts.length
        : 0.8; // Default if no facts extracted

      return Math.min(accuracy, 1.0);

    } catch (error) {
      console.warn('⚠️ [ResponseReranker] Factual accuracy scoring failed:', error);
      return 0.8; // Default good score
    }
  }

  /**
   * Calculate user relevance based on preferences
   */
  private async calculateUserRelevance(response: string, userPreferences: any): Promise<number> {
    try {
      let relevanceScore = 0.8; // Base score

      // Check length preference
      const responseLength = response.length;
      if (userPreferences.preferredLength) {
        if (userPreferences.preferredLength === 'concise' && responseLength < 500) {
          relevanceScore += 0.1;
        } else if (userPreferences.preferredLength === 'detailed' && responseLength > 800) {
          relevanceScore += 0.1;
        } else if (userPreferences.preferredLength === 'medium' && responseLength >= 400 && responseLength <= 800) {
          relevanceScore += 0.1;
        }
      }

      // Check complexity preference
      if (userPreferences.preferredComplexity) {
        const technicalTerms = this.countTechnicalTerms(response);
        const expectedTerms = userPreferences.preferredComplexity === 'basic' ? 2 :
                            userPreferences.preferredComplexity === 'intermediate' ? 5 :
                            userPreferences.preferredComplexity === 'advanced' ? 10 : 5;

        if (Math.abs(technicalTerms - expectedTerms) <= 2) {
          relevanceScore += 0.1;
        }
      }

      // Check interests
      if (userPreferences.interests && userPreferences.interests.length > 0) {
        const matchesInterest = userPreferences.interests.some((interest: string) =>
          response.toLowerCase().includes(interest.toLowerCase())
        );
        if (matchesInterest) {
          relevanceScore += 0.1;
        }
      }

      return Math.min(relevanceScore, 1.0);

    } catch (error) {
      console.warn('⚠️ [ResponseReranker] User relevance scoring failed:', error);
      return 0.8;
    }
  }

  /**
   * Extract sources from response
   */
  private async extractSources(response: string, searchResults: any[]): Promise<string[]> {
    const sources: string[] = [];

    // Pattern-based source extraction
    const sourcePatterns = [
      /(?:source|reference|according to|based on):\s*([^,\n.]+)/gi,
      /\[([^\]]+)\]/g,
      /"(https?:\/\/[^"]+)"/g,
      /(CIR|SCCS|FDA|EU Regulation|ASEAN)/gi,
    ];

    sourcePatterns.forEach(pattern => {
      const matches = response.match(pattern);
      if (matches) {
        sources.push(...matches.map(match =>
          match.replace(/^(?:source|reference|according to|based on):\s*/i, '').trim()
        ));
      }
    });

    // Match response content to search results
    if (searchResults.length > 0) {
      searchResults.forEach(result => {
        const similarity = this.calculateTextSimilarity(response, result.content || '');
        if (similarity > 0.7) {
          sources.push(result.metadata?.name || result.metadata?.title || 'Database Source');
        }
      });
    }

    return [...new Set(sources)].slice(0, 5); // Remove duplicates and limit to 5
  }

  /**
   * Calculate confidence in scoring
   */
  private calculateConfidence(
    relevanceScore: number,
    factualAccuracy: number,
    userRelevance: number
  ): number {
    // Confidence is higher when all scores agree
    const scores = [relevanceScore, factualAccuracy, userRelevance];
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;

    // Lower variance = higher confidence
    return Math.max(0.5, 1.0 - variance);
  }

  /**
   * Extract key facts from text (simplified)
   */
  private extractFacts(text: string): string[] {
    const facts: string[] = [];

    // Look for factual statements
    const sentences = text.split(/[.!?]+/);
    sentences.forEach(sentence => {
      sentence = sentence.trim();
      if (sentence.length > 20 && (
        sentence.includes('is') ||
        sentence.includes('contains') ||
        sentence.includes('provides') ||
        sentence.includes('helps') ||
        sentence.includes('reduces')
      )) {
        facts.push(sentence);
      }
    });

    return facts.slice(0, 10); // Limit to top 10 facts
  }

  /**
   * Check if fact matches search result
   */
  private factMatchesSearch(fact: string, searchResult: any): boolean {
    const searchText = searchResult.content || searchResult.text || '';
    const factWords = fact.toLowerCase().split(' ');

    // Simple matching: check if key words from fact appear in search result
    const matchingWords = factWords.filter(word =>
      word.length > 3 && searchText.toLowerCase().includes(word)
    );

    return matchingWords.length >= 2; // At least 2 key words match
  }

  /**
   * Count technical terms in text
   */
  private countTechnicalTerms(text: string): number {
    const technicalTerms = [
      'vitamin', 'antioxidant', 'extract', 'compound', 'molecule',
      'formulation', 'emulsion', 'stability', 'preservative', 'active',
      'concentration', 'efficacy', 'toxicity', 'safety', 'regulation',
      'mechanism', 'synthesis', 'chemical', 'biological'
    ];

    return technicalTerms.filter(term =>
      text.toLowerCase().includes(term)
    ).length;
  }

  /**
   * Calculate text similarity (simplified)
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = text1.toLowerCase().split(' ');
    const words2 = text2.toLowerCase().split(' ');

    const commonWords = words1.filter(word => words2.includes(word));

    return commonWords.length / Math.max(words1.length, words2.length);
  }

  /**
   * Enhance response based on scoring
   */
  async enhanceResponse(
    query: string,
    response: string,
    searchResults: any[],
    options: ScoringOptions = {}
  ): Promise<{ response: string; score: ResponseScore; enhancements: string[] }> {
    const score = await this.scoreResponse(query, response, searchResults, options);
    const enhancements: string[] = [];

    let enhancedResponse = response;

    // Add sources if missing
    if (score.sources.length === 0 && searchResults.length > 0) {
      const topSources = searchResults.slice(0, 3).map(r =>
        r.metadata?.name || r.metadata?.title || 'Source'
      );
      enhancedResponse += `\n\n**Sources:** ${topSources.join(', ')}`;
      enhancements.push('Added sources');
    }

    // Add confidence disclaimer if low
    if (score.overallScore < 0.6) {
      enhancedResponse += `\n\n*Note: This information may need verification against your specific requirements and regulations.*`;
      enhancements.push('Added verification note');
    }

    // Add structured format if response is too casual
    if (score.overallScore < 0.7 && !enhancedResponse.includes('**')) {
      enhancedResponse = this.addStructureToResponse(enhancedResponse);
      enhancements.push('Added structure');
    }

    return {
      response: enhancedResponse,
      score,
      enhancements
    };
  }

  /**
   * Add structure to response
   */
  private addStructureToResponse(response: string): string {
    const sentences = response.split('. ');
    if (sentences.length < 3) return response;

    return `**Key Points:**\n${sentences.slice(0, 2).join('. ')}.\n\n**Additional Information:**\n${sentences.slice(2).join('. ')}.`;
  }
}