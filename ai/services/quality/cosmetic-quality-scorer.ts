/**
 * Enhanced Answer Quality Scorer for Cosmetic R&D
 * Specialized quality assessment for cosmetic industry responses
 */

import { CosmeticKnowledgeResult } from '../knowledge/cosmetic-knowledge-sources';

// Cosmetic-specific quality assessment interface
export interface CosmeticQualityScore {
  overallScore: number;
  dimensions: {
    factualAccuracy: number;
    safetyCompliance: number;
    regulatoryCompliance: number;
    formulationAccuracy: number;
    completeness: number;
    clarity: number;
    relevance: number;
    sourceQuality: number;
  };
  cosmeticSpecificFactors: {
    ingredientAccuracy: number;
    concentrationGuidelines: number;
    safetyAssessment: number;
    regulatoryStatus: number;
    practicalApplication: number;
  };
  improvementSuggestions: CosmeticImprovementSuggestion[];
  confidenceLevel: number;
  complianceStatus: ComplianceStatus;
  riskAssessment: RiskAssessment;
}

export interface CosmeticImprovementSuggestion {
  category: 'safety' | 'regulatory' | 'formulation' | 'clarity' | 'completeness';
  priority: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  specificActions: string[];
  examples?: string[];
}

export interface ComplianceStatus {
  overallCompliant: boolean;
  fdaCompliant: boolean;
  euCompliant: boolean;
  aseanCompliant: boolean;
  missingCompliance: string[];
  requiredDocumentation: string[];
  regulatoryConcerns: string[];
}

export interface RiskAssessment {
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  safetyRisks: SafetyRisk[];
  regulatoryRisks: RegulatoryRisk[];
  formulationRisks: FormulationRisk[];
  recommendedActions: string[];
}

export interface SafetyRisk {
  risk: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  mitigation: string;
}

export interface RegulatoryRisk {
  risk: string;
  region: string;
  description: string;
  mitigation: string;
}

export interface FormulationRisk {
  risk: string;
  description: string;
  mitigation: string;
}

export interface CosmeticQualityContext {
  userId: string;
  userRole: CosmeticUserRole;
  targetRegions: string[];
  productType: CosmeticProductType;
  queryType: CosmeticQueryType;
  requirements: CosmeticRequirements;
}

export type CosmeticUserRole =
  | 'rd_scientist'
  | 'safety_assessor'
  | 'regulatory_specialist'
  | 'product_manager'
  | 'formulation chemist'
  | 'quality_assurance';

export type CosmeticProductType =
  | 'skincare'
  | 'haircare'
  | 'makeup'
  | 'fragrance'
  | 'oral_care'
  | 'sun_care'
  | 'personal_care';

export type CosmeticQueryType =
  | 'ingredient_safety'
  | 'formulation_advice'
  | 'regulatory_compliance'
  | 'efficacy_claim'
  | 'market_trend'
  | 'technical_specification';

export interface CosmeticRequirements {
  requireSafetyData: boolean;
  requireRegulatoryCompliance: boolean;
  requireFormulationGuidance: boolean;
  requireEfficacyData: boolean;
  requireConcentrationLimits: boolean;
  requireDocumentation: boolean;
}

/**
 * Cosmetic Quality Scorer Service
 */
export class CosmeticQualityScorer {
  private safetyKeywords: string[];
  private regulatoryKeywords: string[];
  private formulationKeywords: string[];
  private concentrationPatterns: RegExp[];
  private ingredientPatterns: RegExp[];

  constructor() {
    this.initializeCosmeticPatterns();
  }

  private initializeCosmeticPatterns(): void {
    // Safety assessment keywords
    this.safetyKeywords = [
      'toxicity', 'irritation', 'sensitization', 'allergy', 'adverse',
      'carcinogenic', 'mutagenic', 'reproductive', 'phototoxic',
      'corrosive', 'danger', 'warning', 'precaution', 'contraindication'
    ];

    // Regulatory compliance keywords
    this.regulatoryKeywords = [
      'fda', 'eu', 'cosing', 'asean', 'regulation', 'compliance',
      'restriction', 'prohibited', 'permitted', 'concentration',
      'maximum', 'minimum', 'requirement', 'guideline', 'standard'
    ];

    // Formulation keywords
    this.formulationKeywords = [
      'formulation', 'ingredient', 'compatibility', 'stability',
      'ph', 'solubility', 'emulsion', 'preservation', 'viscosity',
      'texture', 'absorption', 'penetration', 'delivery'
    ];

    // Concentration patterns (e.g., "0.1%", "10 ppm", "100 mg/kg")
    this.concentrationPatterns = [
      /\d+(\.\d+)?\s*%/g,
      /\d+(\.\d+)?\s*ppm/g,
      /\d+(\.\d+)?\s*mg\/kg/g,
      /\d+(\.\d+)?\s*µg\/g/g
    ];

    // INCI ingredient name patterns
    this.ingredientPatterns = [
      /\b[A-Z][a-z]+(?:-[A-Z][a-z]+)*\b/g, // INCI names like "Sodium Hyaluronate"
      /\b[a-z]+(?:\s+[a-z]+)*\s+(acid|extract|oil|water|seed|leaf|root|flower)\b/gi
    ];
  }

  /**
   * Score AI response quality for cosmetic industry
   */
  async scoreCosmeticResponse(
    response: string,
    query: string,
    context: CosmeticQualityContext,
    knowledgeResult?: CosmeticKnowledgeResult
  ): Promise<CosmeticQualityScore> {
    console.log('📊 [CosmeticQualityScorer] Scoring response quality');

    try {
      // Base quality dimensions
      const baseDimensions = await this.scoreBaseDimensions(response, query, context);

      // Cosmetic-specific factors
      const cosmeticFactors = await this.scoreCosmeticSpecificFactors(response, query, context);

      // Compliance assessment
      const complianceStatus = await this.assessCompliance(response, context);

      // Risk assessment
      const riskAssessment = await this.assessRisks(response, context, knowledgeResult);

      // Generate improvement suggestions
      const improvementSuggestions = this.generateCosmeticImprovements(
        baseDimensions,
        cosmeticFactors,
        complianceStatus,
        riskAssessment
      );

      // Calculate overall score
      const overallScore = this.calculateOverallScore(
        baseDimensions,
        cosmeticFactors,
        complianceStatus,
        riskAssessment
      );

      // Calculate confidence level
      const confidenceLevel = this.calculateConfidenceLevel(
        overallScore,
        baseDimensions,
        knowledgeResult
      );

      console.log('✅ [CosmeticQualityScorer] Quality scoring complete');

      return {
        overallScore,
        dimensions: baseDimensions,
        cosmeticSpecificFactors: cosmeticFactors,
        improvementSuggestions,
        confidenceLevel,
        complianceStatus,
        riskAssessment
      };

    } catch (error) {
      console.error('❌ [CosmeticQualityScorer] Scoring failed:', error);
      return this.getDefaultQualityScore();
    }
  }

  private async scoreBaseDimensions(
    response: string,
    query: string,
    context: CosmeticQualityContext
  ): Promise<CosmeticQualityScore['dimensions']> {
    return {
      factualAccuracy: await this.scoreFactualAccuracy(response, query, context),
      safetyCompliance: await this.scoreSafetyCompliance(response, context),
      regulatoryCompliance: await this.scoreRegulatoryCompliance(response, context),
      formulationAccuracy: await this.scoreFormulationAccuracy(response, context),
      completeness: this.scoreCompleteness(response, query, context),
      clarity: this.scoreClarity(response),
      relevance: this.scoreRelevance(response, query),
      sourceQuality: await this.scoreSourceQuality(response, context)
    };
  }

  private async scoreFactualAccuracy(
    response: string,
    query: string,
    context: CosmeticQualityContext
  ): Promise<number> {
    let score = 0.5; // Base score

    // Check for scientific terminology usage
    const scientificTerms = this.extractScientificTerms(response);
    score += Math.min(scientificTerms.length * 0.05, 0.2);

    // Check for data and measurements
    const hasMeasurements = this.containsMeasurements(response);
    if (hasMeasurements) score += 0.15;

    // Check for references to studies or data
    const hasReferences = this.containsScientificReferences(response);
    if (hasReferences) score += 0.15;

    // Check for specific ingredient information
    const ingredientInfo = this.extractIngredientInfo(response);
    score += Math.min(ingredientInfo.length * 0.02, 0.1);

    return Math.min(score, 1.0);
  }

  private async scoreSafetyCompliance(response: string, context: CosmeticQualityContext): Promise<number> {
    let score = 0.5;

    // Check for safety assessment content
    const safetyContent = response.toLowerCase();
    const safetyKeywordCount = this.safetyKeywords.filter(keyword =>
      safetyContent.includes(keyword)
    ).length;

    score += Math.min(safetyKeywordCount * 0.05, 0.3);

    // Check for concentration limits
    const concentrationInfo = this.extractConcentrationInfo(response);
    if (concentrationInfo.length > 0) score += 0.1;

    // Check for safety warnings or precautions
    const hasWarnings = this.containsSafetyWarnings(response);
    if (hasWarnings) score += 0.1;

    // Extra weight for safety-critical queries
    if (context.queryType === 'ingredient_safety') {
      score = Math.min(score * 1.2, 1.0);
    }

    return Math.min(score, 1.0);
  }

  private async scoreRegulatoryCompliance(response: string, context: CosmeticQualityContext): Promise<number> {
    let score = 0.5;

    const regulatoryContent = response.toLowerCase();
    const regulatoryKeywordCount = this.regulatoryKeywords.filter(keyword =>
      regulatoryContent.includes(keyword)
    ).length;

    score += Math.min(regulatoryKeywordCount * 0.04, 0.25);

    // Check for region-specific regulatory information
    const regionCompliance = this.checkRegionalCompliance(response, context.targetRegions);
    score += regionCompliance * 0.15;

    // Check for documentation requirements
    const hasDocumentationMention = this.containsDocumentationInfo(response);
    if (hasDocumentationMention) score += 0.1;

    return Math.min(score, 1.0);
  }

  private async scoreFormulationAccuracy(response: string, context: CosmeticQualityContext): Promise<number> {
    let score = 0.5;

    const formulationContent = response.toLowerCase();
    const formulationKeywordCount = this.formulationKeywords.filter(keyword =>
      formulationContent.includes(keyword)
    ).length;

    score += Math.min(formulationKeywordCount * 0.03, 0.2);

    // Check for pH information
    const hasPHInfo = this.containsPHInfo(response);
    if (hasPHInfo) score += 0.1;

    // Check for compatibility information
    const hasCompatibilityInfo = this.containsCompatibilityInfo(response);
    if (hasCompatibilityInfo) score += 0.1;

    // Check for stability information
    const hasStabilityInfo = this.containsStabilityInfo(response);
    if (hasStabilityInfo) score += 0.1;

    return Math.min(score, 1.0);
  }

  private scoreCompleteness(
    response: string,
    query: string,
    context: CosmeticQualityContext
  ): number {
    const requiredComponents = this.getRequiredComponents(context.queryType);
    const presentComponents = this.checkPresentComponents(response, requiredComponents);

    const completenessRatio = presentComponents.length / requiredComponents.length;

    // Weight components by importance
    const weightedCompleteness = this.calculateWeightedCompleteness(
      requiredComponents,
      presentComponents
    );

    return Math.min(weightedCompleteness, 1.0);
  }

  private getRequiredComponents(queryType: CosmeticQueryType): string[] {
    const componentMap: Record<CosmeticQueryType, string[]> = {
      ingredient_safety: [
        'safety_assessment',
        'toxicity_data',
        'concentration_limits',
        'regulatory_status',
        'precautions'
      ],
      formulation_advice: [
        'formulation_guidance',
        'compatibility',
        'stability',
        'ph_considerations',
        'usage_instructions'
      ],
      regulatory_compliance: [
        'regulatory_status',
        'compliance_requirements',
        'documentation_needs',
        'regional_restrictions',
        'approval_process'
      ],
      efficacy_claim: [
        'efficacy_data',
        'clinical_evidence',
        'mechanism_of_action',
        'usage_guidelines',
        'limitations'
      ],
      market_trend: [
        'market_data',
        'consumer_preferences',
        'trend_analysis',
        'competitive_landscape',
        'opportunities'
      ],
      technical_specification: [
        'technical_details',
        'specifications',
        'performance_data',
        'quality_standards',
        'testing_methods'
      ]
    };

    return componentMap[queryType] || ['general_information'];
  }

  private checkPresentComponents(response: string, requiredComponents: string[]): string[] {
    const presentComponents: string[] = [];
    const responseLower = response.toLowerCase();

    requiredComponents.forEach(component => {
      const componentKeywords = this.getComponentKeywords(component);
      const hasComponent = componentKeywords.some(keyword =>
        responseLower.includes(keyword)
      );

      if (hasComponent) {
        presentComponents.push(component);
      }
    });

    return presentComponents;
  }

  private getComponentKeywords(component: string): string[] {
    const keywordMap: Record<string, string[]> = {
      safety_assessment: ['safety', 'risk', 'assessment', 'toxicity', 'irritation'],
      toxicity_data: ['toxicity', 'toxicological', 'ld50', 'noael', 'study'],
      concentration_limits: ['concentration', 'limit', 'maximum', 'minimum', 'restriction'],
      regulatory_status: ['regulatory', 'compliance', 'approved', 'permitted', 'prohibited'],
      formulation_guidance: ['formulation', 'recipe', 'instructions', 'guidelines'],
      compatibility: ['compatible', 'incompatible', 'interaction', 'stability'],
      efficacy_data: ['efficacy', 'effective', 'benefit', 'performance', 'results'],
      documentation_needs: ['documentation', 'paperwork', 'requirements', 'submission']
    };

    return keywordMap[component] || [component];
  }

  private calculateWeightedCompleteness(
    requiredComponents: string[],
    presentComponents: string[]
  ): number {
    const importanceWeights: Record<string, number> = {
      safety_assessment: 0.3,
      toxicity_data: 0.25,
      concentration_limits: 0.2,
      regulatory_status: 0.25,
      formulation_guidance: 0.2,
      compatibility: 0.15,
      stability: 0.15,
      efficacy_data: 0.2,
      documentation_needs: 0.15
    };

    let totalWeight = 0;
    let presentWeight = 0;

    requiredComponents.forEach(component => {
      const weight = importanceWeights[component] || 0.1;
      totalWeight += weight;

      if (presentComponents.includes(component)) {
        presentWeight += weight;
      }
    });

    return totalWeight > 0 ? presentWeight / totalWeight : 0;
  }

  private scoreClarity(response: string): number {
    let score = 0.5;

    // Check for structured format
    const hasStructure = this.hasStructuredFormat(response);
    if (hasStructure) score += 0.2;

    // Check for clear section breaks
    const hasSections = this.hasClearSections(response);
    if (hasSections) score += 0.1;

    // Check for appropriate length
    const appropriateLength = this.hasAppropriateLength(response);
    if (appropriateLength) score += 0.1;

    // Check for clear language
    const clearLanguage = this.usesClearLanguage(response);
    if (clearLanguage) score += 0.1;

    return Math.min(score, 1.0);
  }

  private scoreRelevance(response: string, query: string): number {
    const queryWords = query.toLowerCase().split(' ').filter(word => word.length > 3);
    const responseWords = response.toLowerCase().split(' ');

    const matchingWords = queryWords.filter(word =>
      responseWords.includes(word)
    );

    const baseRelevance = matchingWords.length / Math.max(queryWords.length, 1);

    // Bonus for comprehensive coverage
    const comprehensiveBonus = response.length > 500 ? 0.1 : 0;

    return Math.min(baseRelevance + comprehensiveBonus, 1.0);
  }

  private async scoreSourceQuality(response: string, context: CosmeticQualityContext): Promise<number> {
    // Check for source citations
    const citations = this.extractCitations(response);
    let score = Math.min(citations.length * 0.1, 0.3);

    // Check for credible source types
    const credibleSources = this.identifyCredibleSources(response);
    score += Math.min(credibleSources.length * 0.1, 0.4);

    // Check for recent sources
    const recentSources = this.identifyRecentSources(response);
    score += Math.min(recentSources.length * 0.05, 0.2);

    // Check for regulatory sources
    const regulatorySources = this.identifyRegulatorySources(response);
    score += Math.min(regulatorySources.length * 0.1, 0.1);

    return Math.min(score, 1.0);
  }

  private async scoreCosmeticSpecificFactors(
    response: string,
    query: string,
    context: CosmeticQualityContext
  ): Promise<CosmeticQualityScore['cosmeticSpecificFactors']> {
    return {
      ingredientAccuracy: this.scoreIngredientAccuracy(response),
      concentrationGuidelines: this.scoreConcentrationGuidelines(response),
      safetyAssessment: this.scoreSafetyAssessment(response),
      regulatoryStatus: this.scoreRegulatoryStatus(response),
      practicalApplication: this.scorePracticalApplication(response)
    };
  }

  private scoreIngredientAccuracy(response: string): number {
    const ingredients = this.extractIngredients(response);
    if (ingredients.length === 0) return 0.5;

    let validIngredients = 0;
    ingredients.forEach(ingredient => {
      if (this.isValidIngredientFormat(ingredient)) {
        validIngredients++;
      }
    });

    return validIngredients / Math.max(ingredients.length, 1);
  }

  private scoreConcentrationGuidelines(response: string): number {
    const concentrations = this.extractConcentrationInfo(response);
    if (concentrations.length === 0) return 0.3;

    // Check if concentrations are within typical ranges
    const validConcentrations = concentrations.filter(conc =>
      this.isValidConcentration(conc)
    );

    return validConcentrations.length / Math.max(concentrations.length, 1);
  }

  private scoreSafetyAssessment(response: string): number {
    let score = 0.3;

    // Check for safety keywords
    const safetyKeywords = this.safetyKeywords.filter(keyword =>
      response.toLowerCase().includes(keyword)
    );
    score += Math.min(safetyKeywords.length * 0.05, 0.4);

    // Check for risk assessment
    const hasRiskAssessment = this.containsRiskAssessment(response);
    if (hasRiskAssessment) score += 0.2;

    // Check for safety testing references
    const hasTestingReferences = this.containsTestingReferences(response);
    if (hasTestingReferences) score += 0.1;

    return Math.min(score, 1.0);
  }

  private scoreRegulatoryStatus(response: string): number {
    let score = 0.3;

    // Check for regulatory keywords
    const regulatoryKeywords = this.regulatoryKeywords.filter(keyword =>
      response.toLowerCase().includes(keyword)
    );
    score += Math.min(regulatoryKeywords.length * 0.04, 0.4);

    // Check for specific regulatory mentions
    const hasSpecificRegulations = this.containsSpecificRegulations(response);
    if (hasSpecificRegulations) score += 0.2;

    // Check for compliance status
    const hasComplianceStatus = this.containsComplianceStatus(response);
    if (hasComplianceStatus) score += 0.1;

    return Math.min(score, 1.0);
  }

  private scorePracticalApplication(response: string): number {
    let score = 0.3;

    // Check for practical instructions
    const hasInstructions = this.containsPracticalInstructions(response);
    if (hasInstructions) score += 0.3;

    // Check for usage guidelines
    const hasGuidelines = this.containsUsageGuidelines(response);
    if (hasGuidelines) score += 0.2;

    // Check for implementation steps
    const hasImplementationSteps = this.containsImplementationSteps(response);
    if (hasImplementationSteps) score += 0.2;

    return Math.min(score, 1.0);
  }

  // Helper methods for content analysis
  private extractScientificTerms(text: string): string[] {
    const scientificPattern = /\b[A-Z][a-z]+(?:ic|al|ive|ous|tion|sis)\b/g;
    return text.match(scientificPattern) || [];
  }

  private containsMeasurements(text: string): boolean {
    const measurementPattern = /\d+(\.\d+)?\s*(mg|g|kg|µg|ng|%|ppm|ppb)/gi;
    return measurementPattern.test(text);
  }

  private containsScientificReferences(text: string): boolean {
    const referencePatterns = [
      /study|studies|research|clinical|trial|data|evidence/gi,
      /\d{4}/g, // Years
      /et al/gi
    ];

    return referencePatterns.some(pattern => pattern.test(text));
  }

  private extractIngredientInfo(text: string): string[] {
    const ingredients: string[] = [];

    this.ingredientPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        ingredients.push(...matches);
      }
    });

    return [...new Set(ingredients)];
  }

  private extractConcentrationInfo(text: string): string[] {
    const concentrations: string[] = [];

    this.concentrationPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        concentrations.push(...matches);
      }
    });

    return [...new Set(concentrations)];
  }

  private containsSafetyWarnings(text: string): boolean {
    const warningPatterns = [
      /warning|caution|danger|avoid|do not|should not/gi,
      /irritation|sensitization|allergy|adverse/gi
    ];

    return warningPatterns.some(pattern => pattern.test(text));
  }

  private checkRegionalCompliance(text: string, regions: string[]): number {
    let complianceScore = 0;
    const textLower = text.toLowerCase();

    regions.forEach(region => {
      const regionKeywords = this.getRegionKeywords(region);
      const hasRegionInfo = regionKeywords.some(keyword =>
        textLower.includes(keyword)
      );

      if (hasRegionInfo) {
        complianceScore += 1 / regions.length;
      }
    });

    return Math.min(complianceScore, 1.0);
  }

  private getRegionKeywords(region: string): string[] {
    const keywordMap: Record<string, string[]> = {
      us: ['fda', 'united states', 'america', 'us'],
      eu: ['eu', 'european union', 'europe', 'cosing'],
      asean: ['asean', 'southeast asia', 'thailand', 'malaysia', 'singapore'],
      global: ['global', 'international', 'worldwide']
    };

    return keywordMap[region.toLowerCase()] || [region];
  }

  private containsDocumentationInfo(text: string): boolean {
    const documentationKeywords = [
      'documentation', 'paperwork', 'filing', 'submission',
      'certification', 'registration', 'approval', 'permit'
    ];

    return documentationKeywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    );
  }

  private containsPHInfo(text: string): boolean {
    const phPatterns = [/ph\s*:?\s*\d+(\.\d+)?/gi, /acidic|alkaline|neutral/gi];
    return phPatterns.some(pattern => pattern.test(text));
  }

  private containsCompatibilityInfo(text: string): boolean {
    const compatibilityKeywords = [
      'compatible', 'incompatible', 'interaction', 'stability',
      'mixture', 'combination', 'blend'
    ];

    return compatibilityKeywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    );
  }

  private containsStabilityInfo(text: string): boolean {
    const stabilityKeywords = [
      'stable', 'stability', 'shelf life', 'expiration',
      'degradation', 'preservation', 'microbial'
    ];

    return stabilityKeywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    );
  }

  private hasStructuredFormat(text: string): boolean {
    const structureIndicators = [
      /^#{1,6}\s/m, // Headers
      /^\s*[-*+]\s/m, // Lists
      /^\s*\d+\.\s/m, // Numbered lists
      /^\s*\*\*.*\*\*/m // Bold text
    ];

    return structureIndicators.some(pattern => pattern.test(text));
  }

  private hasClearSections(text: string): boolean {
    const sectionIndicators = [
      /introduction|overview|summary/gi,
      /safety|efficacy|usage|application/gi,
      /conclusion|recommendation/gi
    ];

    return sectionIndicators.some(pattern => pattern.test(text));
  }

  private hasAppropriateLength(text: string): boolean {
    return text.length >= 200 && text.length <= 2000;
  }

  private usesClearLanguage(text: string): boolean {
    // Simple check for clear language indicators
    const sentences = text.split(/[.!?]+/);
    const avgSentenceLength = sentences.reduce((sum, sentence) =>
      sum + sentence.split(' ').length, 0) / Math.max(sentences.length, 1);

    // Average sentence length between 10-25 words is considered clear
    return avgSentenceLength >= 10 && avgSentenceLength <= 25;
  }

  private extractCitations(text: string): string[] {
    const citationPatterns = [
      /\([^)]*\d{4}[^)]*\)/g, // (Author, 2024)
      /\[\d+\]/g, // [1], [2]
      /\b\d{4}\b/g // Years
    ];

    const citations: string[] = [];
    citationPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        citations.push(...matches);
      }
    });

    return [...new Set(citations)];
  }

  private identifyCredibleSources(text: string): string[] {
    const credibleSourcePatterns = [
      /pubmed|ncbi|nih/gi,
      /fda|ema|cosing/gi,
      /journal|research|study/gi,
      /clinical|trial|data/gi
    ];

    const credibleSources: string[] = [];
    credibleSourcePatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        credibleSources.push(...matches);
      }
    });

    return [...new Set(credibleSources)];
  }

  private identifyRecentSources(text: string): string[] {
    const yearPattern = /\b(20\d{2})\b/g;
    const currentYear = new Date().getFullYear();
    const matches = text.match(yearPattern) || [];

    return matches.filter(year => {
      const yearNum = parseInt(year);
      return yearNum >= currentYear - 5; // Sources from last 5 years
    });
  }

  private identifyRegulatorySources(text: string): string[] {
    const regulatoryPatterns = [
      /fda|cfr|title\s*21/gi,
      /eu\s*\d+|regulation\s*\d+/gi,
      /asean|cosing|directive/gi
    ];

    const regulatorySources: string[] = [];
    regulatoryPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        regulatorySources.push(...matches);
      }
    });

    return [...new Set(regulatorySources)];
  }

  private extractIngredients(text: string): string[] {
    const ingredients: string[] = [];

    // Extract from different patterns
    const patterns = [
      /\b[A-Z][a-z]+(?:-[A-Z][a-z]+)*\b/g, // INCI names
      /\b[a-z]+(?:\s+[a-z]+)*\s+(acid|extract|oil|water|seed|leaf|root|flower|bark)\b/gi
    ];

    patterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        ingredients.push(...matches);
      }
    });

    // Filter out common words that aren't ingredients
    const filteredIngredients = ingredients.filter(ingredient =>
      !this.isCommonWord(ingredient)
    );

    return [...new Set(filteredIngredients)];
  }

  private isCommonWord(word: string): boolean {
    const commonWords = [
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through',
      'during', 'before', 'after', 'above', 'below', 'between', 'among'
    ];

    return commonWords.includes(word.toLowerCase());
  }

  private isValidIngredientFormat(ingredient: string): boolean {
    // Basic validation for ingredient format
    return (
      ingredient.length > 2 &&
      ingredient.length < 50 &&
      /^[A-Za-z\s\-]+$/.test(ingredient) &&
      !this.isCommonWord(ingredient)
    );
  }

  private isValidConcentration(concentration: string): boolean {
    // Extract numeric value and unit
    const match = concentration.match(/(\d+(?:\.\d+)?)\s*(%|ppm|mg\/kg|µg\/g)/);
    if (!match) return false;

    const value = parseFloat(match[1]);
    const unit = match[2];

    // Check if concentration is within reasonable ranges
    switch (unit) {
      case '%':
        return value >= 0.0001 && value <= 100; // 0.0001% to 100%
      case 'ppm':
        return value >= 0.001 && value <= 1000000; // 0.001ppm to 1,000,000ppm
      case 'mg/kg':
        return value >= 0.001 && value <= 1000000; // 0.001mg/kg to 1,000,000mg/kg
      default:
        return true;
    }
  }

  private containsRiskAssessment(text: string): boolean {
    const riskKeywords = [
      'risk assessment', 'risk evaluation', 'hazard identification',
      'exposure assessment', 'risk characterization', 'margin of safety'
    ];

    return riskKeywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    );
  }

  private containsTestingReferences(text: string): boolean {
    const testingKeywords = [
      'in vitro', 'in vivo', 'clinical study', 'human test',
      'patch test', 'sensitization test', 'irritation test'
    ];

    return testingKeywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    );
  }

  private containsSpecificRegulations(text: string): boolean {
    const regulationPatterns = [
      /CFR\s+\d+\.\d+/gi, // US CFR references
      /Regulation\s+\(EC\)\s+\d+/gi, // EU regulations
      /ASEAN\s+Cosmetic\s+Directive/gi // ASEAN directive
    ];

    return regulationPatterns.some(pattern => pattern.test(text));
  }

  private containsComplianceStatus(text: string): boolean {
    const complianceKeywords = [
      'compliant', 'non-compliant', 'approved', 'not approved',
      'permitted', 'prohibited', 'restricted', 'authorized'
    ];

    return complianceKeywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    );
  }

  private containsPracticalInstructions(text: string): boolean {
    const instructionKeywords = [
      'apply', 'use', 'mix', 'combine', 'add', 'incorporate',
      'heat', 'cool', 'stir', 'blend', 'emulsify'
    ];

    return instructionKeywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    );
  }

  private containsUsageGuidelines(text: string): boolean {
    const guidelineKeywords = [
      'guideline', 'recommendation', 'instruction', 'direction',
      'should', 'must', 'shall', 'advised'
    ];

    return guidelineKeywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    );
  }

  private containsImplementationSteps(text: string): boolean {
    const stepIndicators = [
      /step\s*\d+/gi,
      /^\s*\d+\.\s/m, // Numbered lists
      /first|second|third|finally|lastly/gi
    ];

    return stepIndicators.some(pattern => pattern.test(text));
  }

  private async assessCompliance(
    response: string,
    context: CosmeticQualityContext
  ): Promise<ComplianceStatus> {
    const text = response.toLowerCase();

    return {
      overallCompliant: this.checkOverallCompliance(text, context),
      fdaCompliant: this.checkFDACompliance(text),
      euCompliant: this.checkEUCompliance(text),
      aseanCompliant: this.checkASEANCompliance(text),
      missingCompliance: this.identifyMissingCompliance(text, context),
      requiredDocumentation: this.identifyRequiredDocumentation(text, context),
      regulatoryConcerns: this.identifyRegulatoryConcerns(text, context)
    };
  }

  private checkOverallCompliance(text: string, context: CosmeticQualityContext): boolean {
    const requiredRegions = context.targetRegions;
    let compliantRegions = 0;

    requiredRegions.forEach(region => {
      switch (region.toLowerCase()) {
        case 'us':
          if (this.checkFDACompliance(text)) compliantRegions++;
          break;
        case 'eu':
          if (this.checkEUCompliance(text)) compliantRegions++;
          break;
        case 'asean':
          if (this.checkASEANCompliance(text)) compliantRegions++;
          break;
        default:
          compliantRegions++; // Assume compliant for unknown regions
      }
    });

    return compliantRegions === requiredRegions.length;
  }

  private checkFDACompliance(text: string): boolean {
    const fdaKeywords = ['fda', 'cfr', 'title 21', 'over-the-counter', 'cosmetic'];
    return fdaKeywords.some(keyword => text.includes(keyword));
  }

  private checkEUCompliance(text: string): boolean {
    const euKeywords = ['eu', 'cosing', 'regulation (ec)', 'cosmetic regulation'];
    return euKeywords.some(keyword => text.includes(keyword));
  }

  private checkASEANCompliance(text: string): boolean {
    const aseanKeywords = ['asean', 'cosmetic directive', 'asean cosmetic'];
    return aseanKeywords.some(keyword => text.includes(keyword));
  }

  private identifyMissingCompliance(text: string, context: CosmeticQualityContext): string[] {
    const missing: string[] = [];

    if (context.targetRegions.includes('us') && !this.checkFDACompliance(text)) {
      missing.push('FDA compliance information');
    }

    if (context.targetRegions.includes('eu') && !this.checkEUCompliance(text)) {
      missing.push('EU regulatory compliance');
    }

    if (context.targetRegions.includes('asean') && !this.checkASEANCompliance(text)) {
      missing.push('ASEAN compliance requirements');
    }

    return missing;
  }

  private identifyRequiredDocumentation(text: string, context: CosmeticQualityContext): string[] {
    const documentation: string[] = [];

    if (context.requirements.requireDocumentation) {
      const docTypes = [
        'Safety Assessment',
        'Product Information File',
        'Technical Documentation',
        'Regulatory Submission',
        'Certificate of Analysis'
      ];

      docTypes.forEach(docType => {
        if (text.toLowerCase().includes(docType.toLowerCase())) {
          documentation.push(docType);
        }
      });
    }

    return documentation;
  }

  private identifyRegulatoryConcerns(text: string, context: CosmeticQualityContext): string[] {
    const concerns: string[] = [];

    // Check for prohibited ingredients
    if (text.includes('prohibited') || text.includes('banned')) {
      concerns.push('Contains prohibited ingredients');
    }

    // Check for concentration limits
    if (text.includes('limit') || text.includes('restriction')) {
      concerns.push('Concentration restrictions apply');
    }

    // Check for safety concerns
    if (text.includes('warning') || text.includes('caution')) {
      concerns.push('Safety warnings required');
    }

    return concerns;
  }

  private async assessRisks(
    response: string,
    context: CosmeticQualityContext,
    knowledgeResult?: CosmeticKnowledgeResult
  ): Promise<RiskAssessment> {
    const safetyRisks = this.identifySafetyRisks(response);
    const regulatoryRisks = this.identifyRegulatoryRisks(response, context);
    const formulationRisks = this.identifyFormulationRisks(response);

    const overallRiskLevel = this.calculateOverallRiskLevel(
      safetyRisks,
      regulatoryRisks,
      formulationRisks
    );

    const recommendedActions = this.generateRecommendedActions(
      safetyRisks,
      regulatoryRisks,
      formulationRisks
    );

    return {
      overallRiskLevel,
      safetyRisks,
      regulatoryRisks,
      formulationRisks,
      recommendedActions
    };
  }

  private identifySafetyRisks(response: string): SafetyRisk[] {
    const risks: SafetyRisk[] = [];
    const text = response.toLowerCase();

    if (text.includes('irritation') || text.includes('sensitization')) {
      risks.push({
        risk: 'Skin irritation or sensitization',
        severity: 'high',
        description: 'Potential for causing skin irritation or allergic reactions',
        mitigation: 'Conduct patch testing and include appropriate warnings'
      });
    }

    if (text.includes('phototoxic') || text.includes('photosensitivity')) {
      risks.push({
        risk: 'Phototoxicity',
        severity: 'medium',
        description: 'Increased sensitivity to light',
        mitigation: 'Include sun protection warnings and usage guidelines'
      });
    }

    if (text.includes('toxic') || text.includes('hazard')) {
      risks.push({
        risk: 'Toxicity concerns',
        severity: 'critical',
        description: 'Potential toxic effects at certain concentrations',
        mitigation: 'Follow strict concentration limits and conduct toxicology studies'
      });
    }

    return risks;
  }

  private identifyRegulatoryRisks(response: string, context: CosmeticQualityContext): RegulatoryRisk[] {
    const risks: RegulatoryRisk[] = [];
    const text = response.toLowerCase();

    context.targetRegions.forEach(region => {
      if (region === 'us' && !text.includes('fda')) {
        risks.push({
          risk: 'FDA compliance risk',
          region: 'United States',
          description: 'Missing FDA regulatory information',
          mitigation: 'Review FDA regulations and ensure compliance'
        });
      }

      if (region === 'eu' && !text.includes('cosing')) {
        risks.push({
          risk: 'EU compliance risk',
          region: 'European Union',
          description: 'Missing CosIng database reference',
          mitigation: 'Consult CosIng database and EU cosmetic regulations'
        });
      }
    });

    return risks;
  }

  private identifyFormulationRisks(response: string): FormulationRisk[] {
    const risks: FormulationRisk[] = [];
    const text = response.toLowerCase();

    if (text.includes('unstable') || text.includes('degradation')) {
      risks.push({
        risk: 'Formulation instability',
        description: 'Product may be unstable under certain conditions',
        mitigation: 'Conduct stability testing and include appropriate preservatives'
      });
    }

    if (text.includes('incompatible') || text.includes('interaction')) {
      risks.push({
        risk: 'Ingredient incompatibility',
        description: 'Potential negative interactions between ingredients',
        mitigation: 'Test ingredient compatibility and adjust formulation'
      });
    }

    return risks;
  }

  private calculateOverallRiskLevel(
    safetyRisks: SafetyRisk[],
    regulatoryRisks: RegulatoryRisk[],
    formulationRisks: FormulationRisk[]
  ): 'low' | 'medium' | 'high' | 'critical' {
    const allRisks = [...safetyRisks, ...regulatoryRisks, ...formulationRisks];

    if (allRisks.length === 0) return 'low';

    const criticalRisks = allRisks.filter(r =>
      'severity' in r && (r as SafetyRisk).severity === 'critical'
    ).length;

    const highRisks = allRisks.filter(r =>
      'severity' in r && (r as SafetyRisk).severity === 'high'
    ).length;

    if (criticalRisks > 0) return 'critical';
    if (highRisks > 0 || allRisks.length > 3) return 'high';
    if (allRisks.length > 0) return 'medium';
    return 'low';
  }

  private generateRecommendedActions(
    safetyRisks: SafetyRisk[],
    regulatoryRisks: RegulatoryRisk[],
    formulationRisks: FormulationRisk[]
  ): string[] {
    const actions: string[] = [];

    if (safetyRisks.length > 0) {
      actions.push('Conduct comprehensive safety assessment');
      actions.push('Include appropriate safety warnings');
    }

    if (regulatoryRisks.length > 0) {
      actions.push('Review regulatory requirements for all target markets');
      actions.push('Prepare necessary documentation');
    }

    if (formulationRisks.length > 0) {
      actions.push('Perform stability testing');
      actions.push('Test ingredient compatibility');
    }

    if (actions.length === 0) {
      actions.push('Monitor product performance and user feedback');
    }

    return actions;
  }

  private generateCosmeticImprovements(
    baseDimensions: CosmeticQualityScore['dimensions'],
    cosmeticFactors: CosmeticQualityScore['cosmeticSpecificFactors'],
    complianceStatus: ComplianceStatus,
    riskAssessment: RiskAssessment
  ): CosmeticImprovementSuggestion[] {
    const suggestions: CosmeticImprovementSuggestion[] = [];

    // Safety improvements
    if (baseDimensions.safetyCompliance < 0.7) {
      suggestions.push({
        category: 'safety',
        priority: 'critical',
        description: 'Safety assessment needs improvement',
        specificActions: [
          'Include comprehensive safety evaluation',
          'Add specific toxicity data',
          'Include concentration limits',
          'Add safety warnings and precautions'
        ],
        examples: [
          'Include LD50 or NOAEL values',
          'Specify maximum permitted concentrations',
          'Add skin irritation and sensitization data'
        ]
      });
    }

    // Regulatory improvements
    if (baseDimensions.regulatoryCompliance < 0.7) {
      suggestions.push({
        category: 'regulatory',
        priority: 'high',
        description: 'Regulatory compliance information incomplete',
        specificActions: [
          'Add regulatory status for each region',
          'Include specific regulation references',
          'Add compliance requirements',
          'Include necessary documentation'
        ]
      });
    }

    // Formulation improvements
    if (cosmeticFactors.formulationAccuracy < 0.7) {
      suggestions.push({
        category: 'formulation',
        priority: 'medium',
        description: 'Formulation guidance needs enhancement',
        specificActions: [
          'Add detailed formulation instructions',
          'Include compatibility information',
          'Add stability considerations',
          'Include pH and solubility information'
        ]
      });
    }

    // Clarity improvements
    if (baseDimensions.clarity < 0.7) {
      suggestions.push({
        category: 'clarity',
        priority: 'medium',
        description: 'Response clarity can be improved',
        specificActions: [
          'Use clear section headings',
          'Organize information logically',
          'Define technical terms',
          'Use bullet points for lists'
        ]
      });
    }

    // Completeness improvements
    if (baseDimensions.completeness < 0.7) {
      suggestions.push({
        category: 'completeness',
        priority: 'high',
        description: 'Missing essential information',
        specificActions: [
          'Add practical implementation steps',
          'Include relevant examples',
          'Add source citations',
          'Include limitations and constraints'
        ]
      });
    }

    return suggestions.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  private calculateOverallScore(
    baseDimensions: CosmeticQualityScore['dimensions'],
    cosmeticFactors: CosmeticQualityScore['cosmeticSpecificFactors'],
    complianceStatus: ComplianceStatus,
    riskAssessment: RiskAssessment
  ): number {
    // Weight different components
    const weights = {
      factualAccuracy: 0.2,
      safetyCompliance: 0.25,
      regulatoryCompliance: 0.2,
      formulationAccuracy: 0.15,
      completeness: 0.1,
      clarity: 0.05,
      relevance: 0.05
    };

    let weightedScore = 0;
    Object.entries(weights).forEach(([dimension, weight]) => {
      weightedScore += (baseDimensions[dimension as keyof typeof baseDimensions] as number) * weight;
    });

    // Apply compliance and risk adjustments
    if (!complianceStatus.overallCompliant) {
      weightedScore *= 0.8; // 20% penalty for non-compliance
    }

    if (riskAssessment.overallRiskLevel === 'critical') {
      weightedScore *= 0.7; // 30% penalty for critical risks
    } else if (riskAssessment.overallRiskLevel === 'high') {
      weightedScore *= 0.85; // 15% penalty for high risks
    }

    return Math.min(weightedScore, 1.0);
  }

  private calculateConfidenceLevel(
    overallScore: number,
    baseDimensions: CosmeticQualityScore['dimensions'],
    knowledgeResult?: CosmeticKnowledgeResult
  ): number {
    let confidence = overallScore;

    // Adjust based on source quality
    if (baseDimensions.sourceQuality > 0.8) {
      confidence *= 1.1;
    } else if (baseDimensions.sourceQuality < 0.5) {
      confidence *= 0.9;
    }

    // Adjust based on knowledge result confidence
    if (knowledgeResult) {
      confidence = (confidence + knowledgeResult.confidence) / 2;
    }

    return Math.min(confidence, 1.0);
  }

  private getDefaultQualityScore(): CosmeticQualityScore {
    return {
      overallScore: 0.5,
      dimensions: {
        factualAccuracy: 0.5,
        safetyCompliance: 0.5,
        regulatoryCompliance: 0.5,
        formulationAccuracy: 0.5,
        completeness: 0.5,
        clarity: 0.5,
        relevance: 0.5,
        sourceQuality: 0.5
      },
      cosmeticSpecificFactors: {
        ingredientAccuracy: 0.5,
        concentrationGuidelines: 0.5,
        safetyAssessment: 0.5,
        regulatoryStatus: 0.5,
        practicalApplication: 0.5
      },
      improvementSuggestions: [
        {
          category: 'completeness',
          priority: 'medium',
          description: 'Response quality scoring encountered an error. Please review the response manually.',
          specificActions: [
            'Verify factual accuracy',
            'Check regulatory compliance',
            'Review safety information'
          ]
        }
      ],
      confidenceLevel: 0.3,
      complianceStatus: {
        overallCompliant: false,
        fdaCompliant: false,
        euCompliant: false,
        aseanCompliant: false,
        missingCompliance: ['Unable to assess due to scoring error'],
        requiredDocumentation: [],
        regulatoryConcerns: ['Manual review required']
      },
      riskAssessment: {
        overallRiskLevel: 'medium',
        safetyRisks: [],
        regulatoryRisks: [],
        formulationRisks: [],
        recommendedActions: ['Manual review recommended']
      }
    };
  }
}