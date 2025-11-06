/**
 * Cosmetic Industry Source Credibility Weighting
 * Specialized credibility assessment for cosmetic industry sources
 */

// import { CosmeticKnowledgeSource } from '../knowledge/cosmetic-knowledge-sources';
// import { RegulatorySource } from '../regulatory/cosmetic-regulatory-sources';

// Temporary types until proper exports are available
type CosmeticKnowledgeSource = any;
type RegulatorySource = any;

// Source credibility interfaces
export interface SourceCredibilityProfile {
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  baseCredibility: number;
  credibilityFactors: CredibilityFactors;
  recencyScore: number;
  domainExpertise: number;
  peerReviewStatus: PeerReviewStatus;
  overallCredibility: number;
  lastAssessed: Date;
}

export interface CredibilityFactors {
  authority: number;           // Source authority and reputation
  accuracy: number;           // Historical accuracy rate
  objectivity: number;         // Objectivity and bias assessment
  currency: number;           // How current the information is
  coverage: number;           // Depth and breadth of coverage
  methodology: number;        // Research methodology quality
  transparency: number;       // Transparency of methods and funding
  peerRecognition: number;    // Recognition by peers in field
}

export interface PeerReviewStatus {
  isPeerReviewed: boolean;
  reviewType: 'formal' | 'informal' | 'industry' | 'none';
  reviewFrequency: 'continuous' | 'periodic' | 'occasional' | 'none';
  reviewQuality: 'high' | 'medium' | 'low' | 'none';
  lastReviewDate?: Date;
}

export type SourceType =
  | 'regulatory_authority'
  | 'scientific_journal'
  | 'industry_database'
  | 'safety_database'
  | 'supplier_data'
  | 'market_research'
  | 'patent_database'
  | 'textbook_reference'
  | 'expert_opinion'
  | 'user_generated'
  | 'news_article'
  | 'blog_post'
  | 'social_media';

export interface CosmeticCredibilityConfig {
  weights: {
    authority: number;
    accuracy: number;
    objectivity: number;
    currency: number;
    coverage: number;
    methodology: number;
    transparency: number;
    peerRecognition: number;
  };
  adjustments: {
    regulatoryBonus: number;
    scientificBonus: number;
    industryPenalty: number;
    commercialBiasPenalty: number;
    recencyBonus: number;
    expertiseBonus: number;
  };
  thresholds: {
    minimumAcceptable: number;
    highQuality: number;
    excellent: number;
    commercialThreshold: number;
  };
}

/**
 * Cosmetic Source Credibility Weighting Service
 */
export class CosmeticCredibilityWeightingService {
  private credibilityProfiles: Map<string, SourceCredibilityProfile> = new Map();
  private config: CosmeticCredibilityConfig;
  private credibilityHistory: Map<string, CredibilityHistoryEntry[]> = new Map();

  constructor() {
    this.config = this.initializeConfig();
    this.initializeCredibilityProfiles();
  }

  private initializeConfig(): CosmeticCredibilityConfig {
    return {
      weights: {
        authority: 0.25,        // Regulatory authorities and established institutions
        accuracy: 0.20,         // Historical accuracy and fact-checking record
        objectivity: 0.15,       // Lack of commercial or political bias
        currency: 0.10,          // How recent and up-to-date the information is
        coverage: 0.08,          // Depth and breadth of information provided
        methodology: 0.10,       // Scientific rigor and methodology
        transparency: 0.07,      // Openness about methods, funding, limitations
        peerRecognition: 0.05    // Recognition by other experts and institutions
      },
      adjustments: {
        regulatoryBonus: 0.15,   // Bonus for official regulatory sources
        scientificBonus: 0.10,    // Bonus for peer-reviewed scientific sources
        industryPenalty: -0.10,   // Penalty for commercial industry sources
        commercialBiasPenalty: -0.15, // Penalty for sources with commercial bias
        recencyBonus: 0.05,      // Bonus for very recent information
        expertiseBonus: 0.08      // Bonus for domain-specific expertise
      },
      thresholds: {
        minimumAcceptable: 0.30,  // Minimum credibility to include
        highQuality: 0.70,        // Considered high quality
        excellent: 0.90,          // Excellent credibility
        commercialThreshold: 0.50  // Threshold for commercial bias detection
      }
    };
  }

  private initializeCredibilityProfiles(): void {
    // Regulatory Authority Profiles
    this.addCredibilityProfile({
      sourceId: 'fda_cosmetics',
      sourceName: 'FDA Cosmetic Database',
      sourceType: 'regulatory_authority',
      baseCredibility: 0.95,
      credibilityFactors: {
        authority: 0.98,
        accuracy: 0.95,
        objectivity: 0.97,
        currency: 0.85,
        coverage: 0.80,
        methodology: 0.90,
        transparency: 0.92,
        peerRecognition: 0.88
      },
      recencyScore: 0.85,
      domainExpertise: 0.95,
      peerReviewStatus: {
        isPeerReviewed: true,
        reviewType: 'formal',
        reviewFrequency: 'continuous',
        reviewQuality: 'high',
        lastReviewDate: new Date()
      },
      overallCredibility: 0.92,
      lastAssessed: new Date()
    });

    this.addCredibilityProfile({
      sourceId: 'eu_cosing',
      sourceName: 'EU CosIng Database',
      sourceType: 'regulatory_authority',
      baseCredibility: 0.93,
      credibilityFactors: {
        authority: 0.97,
        accuracy: 0.92,
        objectivity: 0.95,
        currency: 0.90,
        coverage: 0.85,
        methodology: 0.88,
        transparency: 0.90,
        peerRecognition: 0.85
      },
      recencyScore: 0.90,
      domainExpertise: 0.92,
      peerReviewStatus: {
        isPeerReviewed: true,
        reviewType: 'formal',
        reviewFrequency: 'periodic',
        reviewQuality: 'high',
        lastReviewDate: new Date()
      },
      overallCredibility: 0.90,
      lastAssessed: new Date()
    });

    this.addCredibilityProfile({
      sourceId: 'asean_cosmetics',
      sourceName: 'ASEAN Cosmetic Directive',
      sourceType: 'regulatory_authority',
      baseCredibility: 0.88,
      credibilityFactors: {
        authority: 0.92,
        accuracy: 0.85,
        objectivity: 0.90,
        currency: 0.80,
        coverage: 0.75,
        methodology: 0.82,
        transparency: 0.85,
        peerRecognition: 0.80
      },
      recencyScore: 0.80,
      domainExpertise: 0.85,
      peerReviewStatus: {
        isPeerReviewed: true,
        reviewType: 'formal',
        reviewFrequency: 'periodic',
        reviewQuality: 'medium',
        lastReviewDate: new Date()
      },
      overallCredibility: 0.85,
      lastAssessed: new Date()
    });

    // Scientific Journal Profiles
    this.addCredibilityProfile({
      sourceId: 'pubmed_cosmetics',
      sourceName: 'PubMed Cosmetic Research',
      sourceType: 'scientific_journal',
      baseCredibility: 0.90,
      credibilityFactors: {
        authority: 0.88,
        accuracy: 0.92,
        objectivity: 0.90,
        currency: 0.75,
        coverage: 0.85,
        methodology: 0.95,
        transparency: 0.88,
        peerRecognition: 0.95
      },
      recencyScore: 0.75,
      domainExpertise: 0.90,
      peerReviewStatus: {
        isPeerReviewed: true,
        reviewType: 'formal',
        reviewFrequency: 'continuous',
        reviewQuality: 'high',
        lastReviewDate: new Date()
      },
      overallCredibility: 0.88,
      lastAssessed: new Date()
    });

    this.addCredibilityProfile({
      sourceId: 'science_direct',
      sourceName: 'ScienceDirect Cosmetic Journals',
      sourceType: 'scientific_journal',
      baseCredibility: 0.87,
      credibilityFactors: {
        authority: 0.85,
        accuracy: 0.90,
        objectivity: 0.88,
        currency: 0.80,
        coverage: 0.88,
        methodology: 0.92,
        transparency: 0.85,
        peerRecognition: 0.92
      },
      recencyScore: 0.80,
      domainExpertise: 0.88,
      peerReviewStatus: {
        isPeerReviewed: true,
        reviewType: 'formal',
        reviewFrequency: 'continuous',
        reviewQuality: 'high',
        lastReviewDate: new Date()
      },
      overallCredibility: 0.86,
      lastAssessed: new Date()
    });

    // Safety Database Profiles
    this.addCredibilityProfile({
      sourceId: 'cir_reports',
      sourceName: 'CIR Expert Panel Reports',
      sourceType: 'safety_database',
      baseCredibility: 0.89,
      credibilityFactors: {
        authority: 0.92,
        accuracy: 0.88,
        objectivity: 0.92,
        currency: 0.70,
        coverage: 0.80,
        methodology: 0.90,
        transparency: 0.88,
        peerRecognition: 0.90
      },
      recencyScore: 0.70,
      domainExpertise: 0.92,
      peerReviewStatus: {
        isPeerReviewed: true,
        reviewType: 'formal',
        reviewFrequency: 'periodic',
        reviewQuality: 'high',
        lastReviewDate: new Date()
      },
      overallCredibility: 0.87,
      lastAssessed: new Date()
    });

    // Industry Database Profiles
    this.addCredibilityProfile({
      sourceId: 'inci_database',
      sourceName: 'INCI Ingredient Database',
      sourceType: 'industry_database',
      baseCredibility: 0.75,
      credibilityFactors: {
        authority: 0.80,
        accuracy: 0.78,
        objectivity: 0.75,
        currency: 0.70,
        coverage: 0.80,
        methodology: 0.70,
        transparency: 0.72,
        peerRecognition: 0.68
      },
      recencyScore: 0.70,
      domainExpertise: 0.80,
      peerReviewStatus: {
        isPeerReviewed: false,
        reviewType: 'industry',
        reviewFrequency: 'periodic',
        reviewQuality: 'medium',
        lastReviewDate: new Date()
      },
      overallCredibility: 0.74,
      lastAssessed: new Date()
    });

    // Market Research Profiles
    this.addCredibilityProfile({
      sourceId: 'mintel_cosmetics',
      sourceName: 'Mintel Cosmetic Trends',
      sourceType: 'market_research',
      baseCredibility: 0.68,
      credibilityFactors: {
        authority: 0.70,
        accuracy: 0.72,
        objectivity: 0.65,
        currency: 0.95,
        coverage: 0.75,
        methodology: 0.68,
        transparency: 0.60,
        peerRecognition: 0.65
      },
      recencyScore: 0.95,
      domainExpertise: 0.70,
      peerReviewStatus: {
        isPeerReviewed: false,
        reviewType: 'industry',
        reviewFrequency: 'continuous',
        reviewQuality: 'medium',
        lastReviewDate: new Date()
      },
      overallCredibility: 0.70,
      lastAssessed: new Date()
    });
  }

  private addCredibilityProfile(profile: SourceCredibilityProfile): void {
    this.credibilityProfiles.set(profile.sourceId, profile);
  }

  /**
   * Calculate weighted credibility score for a source
   */
  calculateSourceCredibility(
    sourceId: string,
    publicationDate?: Date,
    topicRelevance?: number
  ): CredibilityScore {
    const profile = this.credibilityProfiles.get(sourceId);

    if (!profile) {
      // Default credibility for unknown sources
      return {
        sourceId,
        overallScore: 0.5,
        credibilityBreakdown: this.getDefaultCredibilityBreakdown(),
        adjustments: [],
        riskLevel: 'medium',
        confidence: 0.3,
        lastCalculated: new Date()
      };
    }

    // Calculate base credibility score
    let baseScore = this.calculateBaseScore(profile);

    // Apply recency adjustment
    const recencyAdjustment = this.calculateRecencyAdjustment(profile, publicationDate);

    // Apply expertise adjustment
    const expertiseAdjustment = this.calculateExpertiseAdjustment(profile, topicRelevance);

    // Apply source type adjustments
    const typeAdjustments = this.calculateTypeAdjustments(profile);

    // Apply historical performance adjustments
    const performanceAdjustment = this.calculatePerformanceAdjustment(sourceId);

    // Calculate final score
    const adjustments = [recencyAdjustment, expertiseAdjustment, ...typeAdjustments, performanceAdjustment];
    const finalScore = this.applyAdjustments(baseScore, adjustments);

    // Determine risk level and confidence
    const riskLevel = this.assessRiskLevel(finalScore, profile);
    const confidence = this.calculateConfidence(profile, adjustments);

    return {
      sourceId,
      overallScore: Math.max(0, Math.min(1, finalScore)),
      credibilityBreakdown: {
        baseScore,
        adjustments: adjustments.map(adj => adj.factor),
        finalScore
      },
      adjustments: adjustments.map(adj => ({
        type: adj.type,
        factor: adj.factor,
        reason: adj.reason
      })),
      riskLevel,
      confidence,
      lastCalculated: new Date()
    };
  }

  private calculateBaseScore(profile: SourceCredibilityProfile): number {
    const weights = this.config.weights;
    const cf = profile.credibilityFactors;

    return (
      cf.authority * weights.authority +
      cf.accuracy * weights.accuracy +
      cf.objectivity * weights.objectivity +
      cf.currency * weights.currency +
      cf.coverage * weights.coverage +
      cf.methodology * weights.methodology +
      cf.transparency * weights.transparency +
      cf.peerRecognition * weights.peerRecognition
    );
  }

  private calculateRecencyAdjustment(
    profile: SourceCredibilityProfile,
    publicationDate?: Date
  ): CredibilityAdjustment {
    if (!publicationDate) {
      return { type: 'recency', factor: 0, reason: 'No publication date available' };
    }

    const now = new Date();
    const ageInDays = (now.getTime() - publicationDate.getTime()) / (1000 * 60 * 60 * 24);

    let factor = 0;

    if (ageInDays <= 365) { // Less than 1 year
      factor = this.config.adjustments.recencyBonus;
    } else if (ageInDays <= 1825) { // 1-5 years
      factor = 0;
    } else if (ageInDays <= 3650) { // 5-10 years
      factor = -0.05;
    } else { // More than 10 years
      factor = -0.10;
    }

    // Apply additional factor based on source type
    if (profile.sourceType === 'regulatory_authority' && ageInDays <= 1825) {
      factor += 0.02; // Regulatory information stays relevant longer
    }

    return {
      type: 'recency',
      factor,
      reason: ageInDays <= 365
        ? 'Recent publication (within 1 year)'
        : `Publication age: ${Math.round(ageInDays / 365)} years`
    };
  }

  private calculateExpertiseAdjustment(
    profile: SourceCredibilityProfile,
    topicRelevance?: number
  ): CredibilityAdjustment {
    if (!topicRelevance) {
      return { type: 'expertise', factor: 0, reason: 'No topic relevance data' };
    }

    let factor = 0;

    if (profile.domainExpertise > 0.9 && topicRelevance > 0.8) {
      factor = this.config.adjustments.expertiseBonus;
    } else if (profile.domainExpertise > 0.8 && topicRelevance > 0.7) {
      factor = this.config.adjustments.expertiseBonus * 0.7;
    } else if (profile.domainExpertise > 0.7 && topicRelevance > 0.6) {
      factor = this.config.adjustments.expertiseBonus * 0.5;
    }

    return {
      type: 'expertise',
      factor,
      reason: `Domain expertise: ${(profile.domainExpertise * 100).toFixed(0)}%, Topic relevance: ${(topicRelevance * 100).toFixed(0)}%`
    };
  }

  private calculateTypeAdjustments(profile: SourceCredibilityProfile): CredibilityAdjustment[] {
    const adjustments: CredibilityAdjustment[] = [];

    switch (profile.sourceType) {
      case 'regulatory_authority':
        adjustments.push({
          type: 'regulatory_bonus',
          factor: this.config.adjustments.regulatoryBonus,
          reason: 'Official regulatory authority source'
        });
        break;

      case 'scientific_journal':
        if (profile.peerReviewStatus.isPeerReviewed) {
          adjustments.push({
            type: 'scientific_bonus',
            factor: this.config.adjustments.scientificBonus,
            reason: 'Peer-reviewed scientific source'
          });
        }
        break;

      case 'industry_database':
        adjustments.push({
          type: 'industry_penalty',
          factor: this.config.adjustments.industryPenalty,
          reason: 'Industry database - potential commercial bias'
        });
        break;

      case 'market_research':
        if (profile.credibilityFactors.objectivity < 0.7) {
          adjustments.push({
            type: 'commercial_bias_penalty',
            factor: this.config.adjustments.commercialBiasPenalty,
            reason: 'Potential commercial bias detected'
          });
        }
        break;
    }

    return adjustments;
  }

  private calculatePerformanceAdjustment(sourceId: string): CredibilityAdjustment {
    const history = this.credibilityHistory.get(sourceId);

    if (!history || history.length === 0) {
      return { type: 'performance', factor: 0, reason: 'No performance history' };
    }

    // Calculate recent performance trend
    const recentEntries = history.slice(-10); // Last 10 entries
    const avgAccuracy = recentEntries.reduce((sum, entry) => sum + entry.accuracyScore, 0) / recentEntries.length;

    let factor = 0;
    if (avgAccuracy > 0.9) {
      factor = 0.05; // Bonus for consistently high accuracy
    } else if (avgAccuracy < 0.7) {
      factor = -0.05; // Penalty for poor performance
    }

    return {
      type: 'performance',
      factor,
      reason: `Historical accuracy: ${(avgAccuracy * 100).toFixed(1)}%`
    };
  }

  private applyAdjustments(
    baseScore: number,
    adjustments: CredibilityAdjustment[]
  ): number {
    let adjustedScore = baseScore;

    adjustments.forEach(adj => {
      adjustedScore += adj.factor;
    });

    // Ensure score stays within valid range
    return Math.max(0, Math.min(1, adjustedScore));
  }

  private assessRiskLevel(score: number, profile: SourceCredibilityProfile): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= this.config.thresholds.excellent) {
      return 'low';
    } else if (score >= this.config.thresholds.highQuality) {
      return 'medium';
    } else if (score >= this.config.thresholds.minimumAcceptable) {
      return 'high';
    } else {
      return 'critical';
    }
  }

  private calculateConfidence(
    profile: SourceCredibilityProfile,
    adjustments: CredibilityAdjustment[]
  ): number {
    let confidence = 0.5; // Base confidence

    // Higher confidence for well-established sources
    if (profile.peerReviewStatus.reviewQuality === 'high') {
      confidence += 0.2;
    }

    // Lower confidence for sources with many adjustments
    const significantAdjustments = adjustments.filter(adj => Math.abs(adj.factor) > 0.1);
    confidence -= significantAdjustments.length * 0.05;

    // Higher confidence for sources with good methodology scores
    if (profile.credibilityFactors.methodology > 0.8) {
      confidence += 0.1;
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Record source performance for historical tracking
   */
  recordSourcePerformance(
    sourceId: string,
    accuracyScore: number,
    userFeedback?: UserFeedback
  ): void {
    const entry: CredibilityHistoryEntry = {
      timestamp: new Date(),
      accuracyScore,
      userFeedback,
      context: 'cosmetic_research'
    };

    if (!this.credibilityHistory.has(sourceId)) {
      this.credibilityHistory.set(sourceId, []);
    }

    const history = this.credibilityHistory.get(sourceId)!;
    history.push(entry);

    // Keep only last 50 entries per source
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }
  }

  /**
   * Get credibility summary for multiple sources
   */
  getSourceCredibilitySummary(
    sourceIds: string[],
    publicationDates?: Map<string, Date>,
    topicRelevance?: Map<string, number>
  ): CredibilitySummary {
    const scores = sourceIds.map(sourceId => {
      const pubDate = publicationDates?.get(sourceId);
      const relevance = topicRelevance?.get(sourceId);

      return this.calculateSourceCredibility(sourceId, pubDate, relevance);
    });

    const overallAverage = scores.reduce((sum, score) => sum + score.overallScore, 0) / scores.length;
    const highQualitySources = scores.filter(score => score.overallScore >= this.config.thresholds.highQuality);
    const riskSources = scores.filter(score => score.riskLevel === 'high' || score.riskLevel === 'critical');

    return {
      totalSources: scores.length,
      averageCredibility: overallAverage,
      highQualitySources: highQualitySources.length,
      riskSources: riskSources.length,
      credibilityDistribution: this.calculateDistribution(scores),
      recommendations: this.generateRecommendations(scores),
      lastCalculated: new Date()
    };
  }

  private calculateDistribution(scores: CredibilityScore[]): CredibilityDistribution[] {
    const ranges = [
      { min: 0.0, max: 0.3, label: 'Very Low' },
      { min: 0.3, max: 0.5, label: 'Low' },
      { min: 0.5, max: 0.7, label: 'Medium' },
      { min: 0.7, max: 0.9, label: 'High' },
      { min: 0.9, max: 1.0, label: 'Very High' }
    ];

    return ranges.map(range => ({
      range: range.label,
      count: scores.filter(score => score.overallScore >= range.min && score.overallScore < range.max).length,
      percentage: (scores.filter(score => score.overallScore >= range.min && score.overallScore < range.max).length / scores.length) * 100
    }));
  }

  private generateRecommendations(scores: CredibilityScore[]): string[] {
    const recommendations: string[] = [];

    const avgScore = scores.reduce((sum, score) => sum + score.overallScore, 0) / scores.length;
    const riskSources = scores.filter(score => score.riskLevel === 'high' || score.riskLevel === 'critical');

    if (avgScore < this.config.thresholds.minimumAcceptable) {
      recommendations.push('Overall source credibility is below minimum acceptable threshold. Consider finding more reliable sources.');
    }

    if (riskSources.length > scores.length * 0.3) {
      recommendations.push(`${riskSources.length} sources have high or critical risk levels. Review and verify information from these sources carefully.`);
    }

    const regulatorySources = scores.filter(score => {
      const profile = this.credibilityProfiles.get(score.sourceId);
      return profile?.sourceType === 'regulatory_authority';
    });

    if (regulatorySources.length === 0) {
      recommendations.push('No regulatory authority sources included. Consider adding official regulatory sources for compliance information.');
    }

    const recentSources = scores.filter(score => {
      const adjustment = score.adjustments.find(adj => adj.type === 'recency');
      return adjustment && adjustment.factor > 0;
    });

    if (recentSources.length < scores.length * 0.5) {
      recommendations.push('Many sources are outdated. Consider finding more recent information for current regulatory requirements.');
    }

    return recommendations;
  }

  /**
   * Update credibility profile based on new information
   */
  updateCredibilityProfile(
    sourceId: string,
    updates: Partial<SourceCredibilityProfile>
  ): void {
    const existingProfile = this.credibilityProfiles.get(sourceId);

    if (!existingProfile) {
      console.warn(`⚠️ [CredibilityWeighting] No existing profile for source: ${sourceId}`);
      return;
    }

    const updatedProfile = {
      ...existingProfile,
      ...updates,
      lastAssessed: new Date()
    };

    // Recalculate overall credibility
    updatedProfile.overallCredibility = this.calculateBaseScore(updatedProfile);

    this.credibilityProfiles.set(sourceId, updatedProfile);
  }

  /**
   * Get credibility profile for a source
   */
  getCredibilityProfile(sourceId: string): SourceCredibilityProfile | undefined {
    return this.credibilityProfiles.get(sourceId);
  }

  /**
   * Get all credibility profiles
   */
  getAllCredibilityProfiles(): SourceCredibilityProfile[] {
    return Array.from(this.credibilityProfiles.values());
  }

  private getDefaultCredibilityBreakdown(): CredibilityBreakdown {
    return {
      baseScore: 0.5,
      adjustments: [0],
      finalScore: 0.5
    };
  }
}

// Supporting interfaces
export interface CredibilityScore {
  sourceId: string;
  overallScore: number;
  credibilityBreakdown: CredibilityBreakdown;
  adjustments: AdjustmentDetail[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  lastCalculated: Date;
}

export interface CredibilityBreakdown {
  baseScore: number;
  adjustments: number[];
  finalScore: number;
}

export interface AdjustmentDetail {
  type: string;
  factor: number;
  reason: string;
}

export interface CredibilityAdjustment {
  type: string;
  factor: number;
  reason: string;
}

export interface CredibilityHistoryEntry {
  timestamp: Date;
  accuracyScore: number;
  userFeedback?: UserFeedback;
  context: string;
}

export interface UserFeedback {
  helpful: boolean;
  accurate: boolean;
  relevance: number;
  confidence: number;
  comments?: string;
}

export interface CredibilitySummary {
  totalSources: number;
  averageCredibility: number;
  highQualitySources: number;
  riskSources: number;
  credibilityDistribution: CredibilityDistribution[];
  recommendations: string[];
  lastCalculated: Date;
}

export interface CredibilityDistribution {
  range: string;
  count: number;
  percentage: number;
}