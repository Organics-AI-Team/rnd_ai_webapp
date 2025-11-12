/**
 * Enhanced Knowledge Sources for Cosmetic R&D
 * Specialized configuration for cosmetic industry data sources
 */

import { EnhancedHybridSearchService } from '../rag/enhanced-hybrid-search-service';

// Cosmetic-specific knowledge source configuration
interface CosmeticKnowledgeSource {
  id: string;
  name: string;
  type: 'regulatory' | 'scientific' | 'supplier' | 'safety' | 'market';
  credibility: number;
  recency: number;
  specificity: number;
  completeness: number;
  apiUrl?: string;
  apiKey?: string;
  updateFrequency: 'realtime' | 'daily' | 'weekly' | 'monthly';
  region: 'global' | 'us' | 'eu' | 'asean' | 'asia';
  category: string[];
}

// Cosmetic knowledge sources configuration
export const COSMETIC_KNOWLEDGE_SOURCES: CosmeticKnowledgeSource[] = [
  // Regulatory Sources - Highest priority
  {
    id: 'fda_cosmetics',
    name: 'FDA Cosmetic Database',
    type: 'regulatory',
    credibility: 0.98,
    recency: 0.9,
    specificity: 0.95,
    completeness: 0.9,
    updateFrequency: 'daily',
    region: 'us',
    category: ['regulations', 'safety', 'ingredients']
  },
  {
    id: 'eu_cosing',
    name: 'EU CosIng Database',
    type: 'regulatory',
    credibility: 0.97,
    recency: 0.85,
    specificity: 0.95,
    completeness: 0.9,
    updateFrequency: 'weekly',
    region: 'eu',
    category: ['regulations', 'ingredients', 'restrictions']
  },
  {
    id: 'asean_cosmetics',
    name: 'ASEAN Cosmetic Directive',
    type: 'regulatory',
    credibility: 0.96,
    recency: 0.85,
    specificity: 0.9,
    completeness: 0.85,
    updateFrequency: 'weekly',
    region: 'asean',
    category: ['regulations', 'compliance', 'safety']
  },

  // Scientific Literature Sources
  {
    id: 'pubmed_cosmetics',
    name: 'PubMed Cosmetic Research',
    type: 'scientific',
    credibility: 0.95,
    recency: 0.8,
    specificity: 0.9,
    completeness: 0.85,
    updateFrequency: 'daily',
    region: 'global',
    category: ['research', 'safety', 'efficacy', 'toxicology']
  },
  {
    id: 'science_direct',
    name: 'ScienceDirect Cosmetic Journals',
    type: 'scientific',
    credibility: 0.94,
    recency: 0.8,
    specificity: 0.9,
    completeness: 0.85,
    updateFrequency: 'weekly',
    region: 'global',
    category: ['research', 'formulation', 'efficacy']
  },

  // Safety Assessment Sources
  {
    id: 'cosing_safety',
    name: 'CosIng Safety Database',
    type: 'safety',
    credibility: 0.93,
    recency: 0.85,
    specificity: 0.85,
    completeness: 0.8,
    updateFrequency: 'weekly',
    region: 'eu',
    category: ['safety', 'toxicology', 'restrictions']
  },
  {
    id: 'cir_reports',
    name: 'CIR Expert Panel Reports',
    type: 'safety',
    credibility: 0.92,
    recency: 0.75,
    specificity: 0.8,
    completeness: 0.85,
    updateFrequency: 'monthly',
    region: 'global',
    category: ['safety', 'toxicology', 'assessments']
  },

  // Supplier Technical Data
  {
    id: 'inci_database',
    name: 'INCI Ingredient Database',
    type: 'supplier',
    credibility: 0.85,
    recency: 0.7,
    specificity: 0.8,
    completeness: 0.75,
    updateFrequency: 'monthly',
    region: 'global',
    category: ['ingredients', 'technical_data', 'specifications']
  },

  // Market Intelligence
  {
    id: 'mintel_cosmetics',
    name: 'Mintel Cosmetic Trends',
    type: 'market',
    credibility: 0.82,
    recency: 0.9,
    specificity: 0.75,
    completeness: 0.7,
    updateFrequency: 'weekly',
    region: 'global',
    category: ['trends', 'market_data', 'consumer_insights']
  }
];

/**
 * Enhanced Cosmetic Knowledge Service
 */
export class CosmeticKnowledgeService {
  private searchService: EnhancedHybridSearchService;
  private knowledgeSources: Map<string, CosmeticKnowledgeSource> = new Map();

  constructor(pineconeApiKey: string) {
    this.searchService = new EnhancedHybridSearchService(
      pineconeApiKey,
      process.env.MONGODB_URI || '',
      process.env.MONGODB_DB_NAME || 'rnd_cosmetics',
      'raw_materials',
      'cosmetic-ingredients-index'
    );
    this.initializeKnowledgeSources();
  }

  private initializeKnowledgeSources(): void {
    COSMETIC_KNOWLEDGE_SOURCES.forEach(source => {
      this.knowledgeSources.set(source.id, source);
    });
  }

  /**
   * Perform comprehensive cosmetic knowledge retrieval
   */
  async retrieveCosmeticKnowledge(
    query: string,
    context: CosmeticSearchContext
  ): Promise<CosmeticKnowledgeResult> {
    console.log('🔍 [CosmeticKnowledgeService] Retrieving knowledge for:', query);

    // Identify relevant sources based on query and context
    const relevantSources = this.identifyRelevantSources(query, context);

    // Perform parallel search across relevant sources
    const searchPromises = relevantSources.map(source =>
      this.searchWithCredibilityWeight(source, query, context)
    );

    const searchResults = await Promise.allSettled(searchPromises);

    // Process and synthesize results
    const processedResults = await this.processCosmeticResults(searchResults, query, context);

    // Apply cosmetic-specific ranking
    const rankedResults = this.rankCosmeticResults(processedResults, context);

    // Generate knowledge synthesis
    const synthesis = await this.synthesizeCosmeticKnowledge(rankedResults, query, context);

    console.log('✅ [CosmeticKnowledgeService] Knowledge retrieval complete');

    return {
      query,
      synthesis,
      sources: rankedResults.slice(0, 10), // Top 10 results
      confidence: this.calculateKnowledgeConfidence(rankedResults),
      relevance: this.calculateRelevanceScore(rankedResults, query),
      coverage: this.assessCoverage(rankedResults, context),
      timestamp: new Date()
    };
  }

  private identifyRelevantSources(
    query: string,
    context: CosmeticSearchContext
  ): CosmeticKnowledgeSource[] {
    const relevantSources: CosmeticKnowledgeSource[] = [];

    // Analyze query type
    const queryType = this.classifyCosmeticQuery(query);

    // Add sources based on query type and context
    COSMETIC_KNOWLEDGE_SOURCES.forEach(source => {
      if (this.isSourceRelevant(source, queryType, context)) {
        relevantSources.push(source);
      }
    });

    // Sort by relevance score
    return relevantSources.sort((a, b) => {
      const scoreA = this.calculateSourceRelevanceScore(a, queryType, context);
      const scoreB = this.calculateSourceRelevanceScore(b, queryType, context);
      return scoreB - scoreA;
    });
  }

  private calculateSourceRelevanceScore(
    source: CosmeticKnowledgeSource,
    queryType: CosmeticQueryType,
    context: any
  ): number {
    let score = source.credibility;

    // Boost regulatory sources for safety queries
    if (queryType.includes('safety') && source.type === 'regulatory') {
      score += 0.2;
    }

    // Boost scientific sources for formulation queries
    if (queryType.includes('formulation') && source.type === 'scientific') {
      score += 0.2;
    }

    // Consider recency for time-sensitive queries
    score += source.recency * 0.1;

    return score;
  }

  private classifyCosmeticQuery(query: string): CosmeticQueryType {
    const queryLower = query.toLowerCase();

    // Safety-related queries
    if (queryLower.includes('safety') || queryLower.includes('toxic') ||
        queryLower.includes('irritation') || queryLower.includes('allergy')) {
      return 'safety';
    }

    // Regulatory queries
    if (queryLower.includes('regulation') || queryLower.includes('compliance') ||
        queryLower.includes('legal') || queryLower.includes('fda') ||
        queryLower.includes('eu') || queryLower.includes('asean')) {
      return 'regulatory';
    }

    // Formulation queries
    if (queryLower.includes('formulation') || queryLower.includes('recipe') ||
        queryLower.includes('ingredient') || queryLower.includes('mix') ||
        queryLower.includes('compatibility')) {
      return 'formulation';
    }

    // Efficacy queries
    if (queryLower.includes('efficacy') || queryLower.includes('effective') ||
        queryLower.includes('benefit') || queryLower.includes('result') ||
        queryLower.includes('performance')) {
      return 'efficacy';
    }

    // Market queries
    if (queryLower.includes('market') || queryLower.includes('trend') ||
        queryLower.includes('consumer') || queryLower.includes('popular')) {
      return 'market';
    }

    return 'general';
  }

  private isSourceRelevant(
    source: CosmeticKnowledgeSource,
    queryType: CosmeticQueryType,
    context: CosmeticSearchContext
  ): boolean {
    // Check if source category matches query type
    const categoryMatch = this.checkCategoryMatch(source.category, queryType);

    // Check region relevance
    const regionMatch = this.checkRegionMatch(source.region, context);

    // Check recency requirements
    const recencyMatch = this.checkRecencyMatch(source.recency, context);

    return categoryMatch && regionMatch && recencyMatch;
  }

  private checkCategoryMatch(sourceCategories: string[], queryType: CosmeticQueryType): boolean {
    const categoryMappings: Record<CosmeticQueryType, string[]> = {
      safety: ['safety', 'toxicology', 'ingredients', 'restrictions'],
      regulatory: ['regulations', 'compliance', 'safety', 'ingredients', 'restrictions'],
      formulation: ['ingredients', 'technical_data', 'specifications', 'research'],
      efficacy: ['research', 'efficacy', 'ingredients', 'market_data'],
      market: ['trends', 'market_data', 'consumer_insights', 'research'],
      general: ['ingredients', 'research', 'safety', 'regulations']
    };

    const relevantCategories = categoryMappings[queryType];
    return sourceCategories.some(cat => relevantCategories.includes(cat));
  }

  private checkRegionMatch(sourceRegion: string, context: CosmeticSearchContext): boolean {
    if (context.region === 'global') return true;
    if (sourceRegion === 'global') return true;
    return sourceRegion === context.region;
  }

  private checkRecencyMatch(sourceRecency: number, context: CosmeticSearchContext): boolean {
    const minRecency = context.requireLatestInfo ? 0.8 : 0.5;
    return sourceRecency >= minRecency;
  }

  private async searchWithCredibilityWeight(
    source: CosmeticKnowledgeSource,
    query: string,
    context: CosmeticSearchContext
  ): Promise<WeightedSearchResult[]> {
    try {
      // Perform search using the enhanced hybrid search
      const searchResults = await this.searchService.enhancedSearch({
        query,
        category: 'cosmetics',
        topK: 20,
        includeMetadata: true
      });

      // Apply credibility weighting
      return searchResults.map(result => ({
        id: result.document?.id || result.document?._id || Math.random().toString(),
        content: result.document?.content || result.document?.text || JSON.stringify(result.document),
        score: result.score,
        metadata: result.document,
        source,
        credibilityWeight: source.credibility,
        weightedScore: result.score * source.credibility,
        sourceMetadata: {
          credibility: source.credibility,
          recency: source.recency,
          specificity: source.specificity,
          completeness: source.completeness
        }
      }));

    } catch (error) {
      console.warn(`⚠️ [CosmeticKnowledgeService] Search failed for ${source.name}:`, error);
      return [];
    }
  }

  private async processCosmeticResults(
    searchResults: PromiseSettledResult<WeightedSearchResult[]>[],
    query: string,
    context: CosmeticSearchContext
  ): Promise<WeightedSearchResult[]> {
    const allResults: WeightedSearchResult[] = [];

    searchResults.forEach(result => {
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      } else {
        console.warn('⚠️ [CosmeticKnowledgeService] Search promise rejected:', result.reason);
      }
    });

    // Remove duplicates and apply cosmetic-specific filtering
    return this.deduplicateAndFilter(allResults, query, context);
  }

  private deduplicateAndFilter(
    results: WeightedSearchResult[],
    query: string,
    context: CosmeticSearchContext
  ): WeightedSearchResult[] {
    // Remove duplicates based on content similarity
    const uniqueResults: WeightedSearchResult[] = [];
    const seenContent = new Set<string>();

    results.forEach(result => {
      const contentHash = this.generateContentHash(result.content);

      if (!seenContent.has(contentHash)) {
        seenContent.add(contentHash);

        // Apply cosmetic-specific filters
        if (this.passesCosmeticFilters(result, context)) {
          uniqueResults.push(result);
        }
      }
    });

    return uniqueResults;
  }

  private generateContentHash(content: string): string {
    // Simple hash for deduplication
    return content.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
  }

  private passesCosmeticFilters(result: WeightedSearchResult, context: CosmeticSearchContext): boolean {
    // Filter for relevant content
    const content = result.content.toLowerCase();

    // Must contain cosmetic-related terms
    const cosmeticTerms = [
      'cosmetic', 'skin', 'hair', 'beauty', 'personal care',
      'ingredient', 'formulation', 'safety', 'efficacy', 'regulation'
    ];

    const hasCosmeticTerms = cosmeticTerms.some(term => content.includes(term));

    // Check for relevance to query
    const queryTerms = context.originalQuery.toLowerCase().split(' ');
    const hasQueryTerms = queryTerms.some(term =>
      term.length > 3 && content.includes(term)
    );

    return hasCosmeticTerms && hasQueryTerms;
  }

  private rankCosmeticResults(
    results: WeightedSearchResult[],
    context: CosmeticSearchContext
  ): WeightedSearchResult[] {
    return results.sort((a, b) => {
      // Calculate comprehensive ranking score
      const scoreA = this.calculateCosmeticRankingScore(a, context);
      const scoreB = this.calculateCosmeticRankingScore(b, context);

      return scoreB - scoreA;
    });
  }

  private calculateCosmeticRankingScore(
    result: WeightedSearchResult,
    context: CosmeticSearchContext
  ): number {
    const weights = {
      credibility: 0.3,
      relevance: 0.25,
      recency: 0.2,
      specificity: 0.15,
      completeness: 0.1
    };

    return (
      result.source.credibility * weights.credibility +
      result.weightedScore * weights.relevance +
      result.source.recency * weights.recency +
      result.source.specificity * weights.specificity +
      result.source.completeness * weights.completeness
    );
  }

  private async synthesizeCosmeticKnowledge(
    results: WeightedSearchResult[],
    query: string,
    context: CosmeticSearchContext
  ): Promise<CosmeticKnowledgeSynthesis> {
    // Group results by category
    const categorizedResults = this.groupByCategory(results);

    // Extract key insights
    const keyInsights = this.extractKeyInsights(categorizedResults, query);

    // Identify consensus and conflicts
    const consensus = this.analyzeConsensus(categorizedResults);

    // Generate recommendations
    const recommendations = this.generateRecommendations(keyInsights, consensus, context);

    // Assess knowledge gaps
    const knowledgeGaps = this.identifyKnowledgeGaps(results, query);

    return {
      summary: this.generateSummary(keyInsights, consensus),
      keyInsights,
      consensus,
      recommendations,
      knowledgeGaps,
      confidenceLevel: this.calculateSynthesisConfidence(results),
      lastUpdated: new Date()
    };
  }

  private groupByCategory(results: WeightedSearchResult[]): Record<string, WeightedSearchResult[]> {
    const grouped: Record<string, WeightedSearchResult[]> = {};

    results.forEach(result => {
      const categories = result.source.category;
      categories.forEach(category => {
        if (!grouped[category]) {
          grouped[category] = [];
        }
        grouped[category].push(result);
      });
    });

    return grouped;
  }

  private extractKeyInsights(
    categorizedResults: Record<string, WeightedSearchResult[]>,
    query: string
  ): CosmeticInsight[] {
    const insights: CosmeticInsight[] = [];

    // Extract insights from each category
    Object.entries(categorizedResults).forEach(([category, results]) => {
      const topResults = results.slice(0, 3); // Top 3 results per category

      topResults.forEach(result => {
        insights.push({
          category,
          insight: this.extractInsightFromResult(result, query),
          source: result.source.name,
          confidence: result.weightedScore,
          relevance: result.score
        });
      });
    });

    // Sort by confidence and relevance
    return insights.sort((a, b) => (b.confidence * b.relevance) - (a.confidence * a.relevance));
  }

  private extractInsightFromResult(result: WeightedSearchResult, query: string): string {
    // Extract the most relevant insight from the result
    const sentences = result.content.split('. ');
    const queryWords = query.toLowerCase().split(' ');

    // Find sentences most relevant to query
    const relevantSentences = sentences.filter(sentence =>
      queryWords.some(word => word.length > 3 && sentence.toLowerCase().includes(word))
    );

    return relevantSentences[0] || sentences[0] || result.content.slice(0, 200) + '...';
  }

  private analyzeConsensus(
    categorizedResults: Record<string, WeightedSearchResult[]>
  ): CosmeticConsensus {
    const consensusPoints: ConsensusPoint[] = [];
    const conflicts: ConflictPoint[] = [];

    // Analyze each category for consensus
    Object.entries(categorizedResults).forEach(([category, results]) => {
      if (results.length >= 2) {
        const categoryConsensus = this.analyzeCategoryConsensus(category, results);
        consensusPoints.push(...categoryConsensus.consensus);
        conflicts.push(...categoryConsensus.conflicts);
      }
    });

    return {
      consensusPoints,
      conflicts,
      overallAgreement: this.calculateOverallAgreement(consensusPoints, conflicts)
    };
  }

  private analyzeCategoryConsensus(
    category: string,
    results: WeightedSearchResult[]
  ): { consensus: ConsensusPoint[]; conflicts: ConflictPoint[] } {
    const consensus: ConsensusPoint[] = [];
    const conflicts: ConflictPoint[] = [];

    // Simple consensus analysis based on content similarity
    const uniqueInsights = this.extractUniqueInsights(results);

    uniqueInsights.forEach(insight => {
      const supportingResults = results.filter(r =>
        this.resultSupportsInsight(r, insight)
      );

      if (supportingResults.length >= 2) {
        consensus.push({
          topic: insight.category,
          statement: insight.insight,
          supportingSources: supportingResults.map(r => r.source.name),
          confidenceLevel: this.calculateConsensusConfidence(supportingResults)
        });
      } else if (supportingResults.length === 1) {
        // Potential conflicting information
        conflicts.push({
          topic: insight.category,
          conflictingStatement: insight.insight,
          source: supportingResults[0].source.name,
          nature: 'single_source_claim'
        });
      }
    });

    return { consensus, conflicts };
  }

  private extractUniqueInsights(results: WeightedSearchResult[]): CosmeticInsight[] {
    // Extract unique insights from results
    const insights: CosmeticInsight[] = [];
    const seenStatements = new Set<string>();

    results.forEach(result => {
      const sentences = result.content.split('. ');
      sentences.forEach(sentence => {
        const statement = sentence.trim();
        if (statement.length > 20 && !seenStatements.has(statement)) {
          seenStatements.add(statement);
          insights.push({
            category: this.extractTopic(statement),
            insight: statement,
            source: result.source.name,
            confidence: result.weightedScore,
            relevance: result.score
          });
        }
      });
    });

    return insights;
  }

  private extractTopic(sentence: string): string {
    // Extract main topic from sentence
    const words = sentence.split(' ');
    const cosmeticKeywords = [
      'ingredient', 'safety', 'efficacy', 'regulation', 'formulation',
      'concentration', 'restriction', 'usage', 'benefit', 'risk'
    ];

    for (const keyword of cosmeticKeywords) {
      if (sentence.toLowerCase().includes(keyword)) {
        return keyword;
      }
    }

    return words[0] || 'general';
  }

  private resultSupportsInsight(result: WeightedSearchResult, insight: CosmeticInsight): boolean {
    // Check if result supports the insight
    const resultContent = result.content.toLowerCase();
    const insightStatement = insight.insight.toLowerCase();

    // Simple similarity check
    return resultContent.includes(insightStatement.substring(0, 50));
  }

  private calculateConsensusConfidence(supportingResults: WeightedSearchResult[]): number {
    // Calculate confidence based on supporting results
    const avgCredibility = supportingResults.reduce((sum, r) => sum + r.source.credibility, 0) / supportingResults.length;
    const avgScore = supportingResults.reduce((sum, r) => sum + r.weightedScore, 0) / supportingResults.length;

    return (avgCredibility + avgScore) / 2;
  }

  private calculateOverallAgreement(
    consensus: ConsensusPoint[],
    conflicts: ConflictPoint[]
  ): number {
    const totalPoints = consensus.length + conflicts.length;
    if (totalPoints === 0) return 0.5;

    const agreementRatio = consensus.length / totalPoints;
    return agreementRatio;
  }

  private generateRecommendations(
    insights: CosmeticInsight[],
    consensus: CosmeticConsensus,
    context: CosmeticSearchContext
  ): CosmeticRecommendation[] {
    const recommendations: CosmeticRecommendation[] = [];

    // Safety recommendations
    const safetyInsights = insights.filter(i => i.category === 'safety');
    if (safetyInsights.length > 0) {
      recommendations.push({
        type: 'safety',
        priority: 'high',
        recommendation: this.generateSafetyRecommendation(safetyInsights, consensus),
        sources: safetyInsights.map(i => i.source)
      });
    }

    // Regulatory recommendations
    const regulatoryInsights = insights.filter(i => i.category === 'regulations');
    if (regulatoryInsights.length > 0) {
      recommendations.push({
        type: 'regulatory',
        priority: 'high',
        recommendation: this.generateRegulatoryRecommendation(regulatoryInsights, consensus),
        sources: regulatoryInsights.map(i => i.source)
      });
    }

    // Formulation recommendations
    const formulationInsights = insights.filter(i => i.category === 'ingredients');
    if (formulationInsights.length > 0) {
      recommendations.push({
        type: 'formulation',
        priority: 'medium',
        recommendation: this.generateFormulationRecommendation(formulationInsights, consensus),
        sources: formulationInsights.map(i => i.source)
      });
    }

    return recommendations;
  }

  private generateSafetyRecommendation(
    insights: CosmeticInsight[],
    consensus: CosmeticConsensus
  ): string {
    const highConfidenceInsights = insights.filter(i => i.confidence > 0.8);

    if (consensus.conflicts.length > 0) {
      return 'Multiple sources indicate safety concerns. Comprehensive safety assessment required. Consult regulatory databases and consider additional testing.';
    }

    if (highConfidenceInsights.length > 0) {
      return 'Safety data available from multiple credible sources. Review specific concentration limits and usage restrictions before formulation.';
    }

    return 'Limited safety data available. Recommend comprehensive safety assessment including toxicological evaluation.';
  }

  private generateRegulatoryRecommendation(
    insights: CosmeticInsight[],
    consensus: CosmeticConsensus
  ): string {
    const consensusPoints = consensus.consensusPoints.filter(cp =>
      cp.topic === 'regulation' || cp.topic === 'compliance'
    );

    if (consensusPoints.length > 0) {
      return `Regulatory status confirmed by ${consensusPoints.length} sources. Ensure compliance with regional requirements and maintain proper documentation.`;
    }

    return 'Regulatory information varies by region. Verify compliance requirements for each target market.';
  }

  private generateFormulationRecommendation(
    insights: CosmeticInsight[],
    consensus: CosmeticConsensus
  ): string {
    const efficacyInsights = insights.filter(i => i.insight.includes('efficacy') || i.insight.includes('effective'));
    const compatibilityInsights = insights.filter(i => i.insight.includes('compatibility') || i.insight.includes('stable'));

    let recommendation = 'Consider formulation guidelines: ';

    if (efficacyInsights.length > 0) {
      recommendation += 'Optimize concentration for efficacy. ';
    }

    if (compatibilityInsights.length > 0) {
      recommendation += 'Test compatibility with other ingredients. ';
    }

    recommendation += 'Conduct stability testing under various conditions.';

    return recommendation;
  }

  private identifyKnowledgeGaps(
    results: WeightedSearchResult[],
    query: string
  ): KnowledgeGap[] {
    const gaps: KnowledgeGap[] = [];

    // Check for missing categories
    const availableCategories = new Set();
    results.forEach(r => r.source.category.forEach(cat => availableCategories.add(cat)));

    const requiredCategories = ['safety', 'regulations', 'ingredients'];
    requiredCategories.forEach(category => {
      if (!availableCategories.has(category)) {
        gaps.push({
          category,
          description: `Limited information available for ${category} aspects`,
          severity: 'medium',
          suggestedActions: [
            `Search specialized ${category} databases`,
            `Consult regulatory authorities`,
            `Review scientific literature`
          ]
        });
      }
    });

    // Check for recency gaps
    const recentResults = results.filter(r => r.source.recency > 0.8);
    if (recentResults.length < results.length * 0.3) {
      gaps.push({
        category: 'recency',
        description: 'Limited recent information available',
        severity: 'low',
        suggestedActions: [
          'Search for recent publications',
          'Check regulatory updates',
          'Review industry guidelines'
        ]
      });
    }

    return gaps;
  }

  private calculateKnowledgeConfidence(results: WeightedSearchResult[]): number {
    if (results.length === 0) return 0;

    // Calculate confidence based on source credibility and result scores
    const avgCredibility = results.reduce((sum, r) => sum + r.source.credibility, 0) / results.length;
    const avgScore = results.reduce((sum, r) => sum + r.weightedScore, 0) / results.length;

    // Weight credibility more heavily
    return (avgCredibility * 0.7) + (avgScore * 0.3);
  }

  private calculateRelevanceScore(results: WeightedSearchResult[], query: string): number {
    if (results.length === 0) return 0;

    return results.reduce((sum, r) => sum + r.score, 0) / results.length;
  }

  private assessCoverage(results: WeightedSearchResult[], context: CosmeticSearchContext): CoverageAssessment {
    const categories = new Set<string>();
    const sources = new Set<string>();
    const regions = new Set<string>();

    results.forEach(result => {
      result.source.category.forEach(cat => categories.add(cat));
      sources.add(result.source.name);
      regions.add(result.source.region);
    });

    return {
      categories: Array.from(categories),
      sources: Array.from(sources),
      regions: Array.from(regions),
      completeness: Math.min(categories.size / 5, 1.0), // 5 main categories
      diversity: Math.min(sources.size / 8, 1.0), // 8 main sources
      geographic: Math.min(regions.size / 4, 1.0) // 4 main regions
    };
  }

  private generateSummary(insights: CosmeticInsight[], consensus: CosmeticConsensus): string {
    const topInsights = insights.slice(0, 3);
    const consensusLevel = consensus.overallAgreement;

    let summary = `Analysis of ${insights.length} sources reveals `;

    if (consensusLevel > 0.7) {
      summary += 'strong consensus among credible sources. ';
    } else if (consensusLevel > 0.4) {
      summary += 'moderate agreement with some variations. ';
    } else {
      summary += 'diverse perspectives requiring further investigation. ';
    }

    summary += `Key findings include: ${topInsights.map(i => i.insight.substring(0, 100)).join('; ')}`;

    return summary;
  }

  private calculateSynthesisConfidence(results: WeightedSearchResult[]): number {
    if (results.length === 0) return 0;

    // Base confidence on source credibility and consensus
    const sourceCredibility = this.calculateKnowledgeConfidence(results);
    const sourceDiversity = Math.min(results.length / 10, 1.0); // More diverse sources = higher confidence

    return (sourceCredibility * 0.8) + (sourceDiversity * 0.2);
  }
}

// Type definitions
export interface CosmeticSearchContext {
  region: string;
  requireLatestInfo: boolean;
  productType?: string;
  targetMarket?: string[];
  originalQuery: string;
}

export interface CosmeticKnowledgeResult {
  query: string;
  synthesis: CosmeticKnowledgeSynthesis;
  sources: WeightedSearchResult[];
  confidence: number;
  relevance: number;
  coverage: CoverageAssessment;
  timestamp: Date;
}

export interface CosmeticKnowledgeSynthesis {
  summary: string;
  keyInsights: CosmeticInsight[];
  consensus: CosmeticConsensus;
  recommendations: CosmeticRecommendation[];
  knowledgeGaps: KnowledgeGap[];
  confidenceLevel: number;
  lastUpdated: Date;
}

export interface CosmeticInsight {
  category: string;
  insight: string;
  source: string;
  confidence: number;
  relevance: number;
}

export interface CosmeticConsensus {
  consensusPoints: ConsensusPoint[];
  conflicts: ConflictPoint[];
  overallAgreement: number;
}

export interface ConsensusPoint {
  topic: string;
  statement: string;
  supportingSources: string[];
  confidenceLevel: number;
}

export interface ConflictPoint {
  topic: string;
  conflictingStatement: string;
  source: string;
  nature: string;
}

export interface CosmeticRecommendation {
  type: 'safety' | 'regulatory' | 'formulation' | 'market';
  priority: 'high' | 'medium' | 'low';
  recommendation: string;
  sources: string[];
}

export interface KnowledgeGap {
  category: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  suggestedActions: string[];
}

export interface CoverageAssessment {
  categories: string[];
  sources: string[];
  regions: string[];
  completeness: number;
  diversity: number;
  geographic: number;
}

export interface WeightedSearchResult {
  id: string;
  content: string;
  score: number;
  metadata: any;
  source: CosmeticKnowledgeSource;
  credibilityWeight: number;
  weightedScore: number;
  sourceMetadata: {
    credibility: number;
    recency: number;
    specificity: number;
    completeness: number;
  };
}

export type CosmeticQueryType = 'safety' | 'regulatory' | 'formulation' | 'efficacy' | 'market' | 'general';