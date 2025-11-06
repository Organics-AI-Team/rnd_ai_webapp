/**
 * Cosmetic Quality Scoring Thresholds
 * Specialized threshold configurations for safety assessments and compliance
 */

import { CosmeticQualityScore } from '../quality/cosmetic-quality-scorer';

// Threshold configuration interfaces
export interface CosmeticQualityThresholds {
  overall: ThresholdLevel;
  dimensions: DimensionThresholds;
  cosmeticFactors: CosmeticFactorThresholds;
  compliance: ComplianceThresholds;
  risk: RiskThresholds;
  productTypeSpecific: ProductTypeThresholds;
  userRoleSpecific: UserRoleThresholds;
}

export interface ThresholdLevel {
  excellent: number;
  good: number;
  acceptable: number;
  minimum: number;
  critical: number;
}

export interface DimensionThresholds {
  factualAccuracy: ThresholdLevel;
  safetyCompliance: ThresholdLevel;
  regulatoryCompliance: ThresholdLevel;
  formulationAccuracy: ThresholdLevel;
  completeness: ThresholdLevel;
  clarity: ThresholdLevel;
  relevance: ThresholdLevel;
  sourceQuality: ThresholdLevel;
}

export interface CosmeticFactorThresholds {
  ingredientAccuracy: ThresholdLevel;
  concentrationGuidelines: ThresholdLevel;
  safetyAssessment: ThresholdLevel;
  regulatoryStatus: ThresholdLevel;
  practicalApplication: ThresholdLevel;
}

export interface ComplianceThresholds {
  fdaCompliance: ComplianceLevel;
  euCompliance: ComplianceLevel;
  aseanCompliance: ComplianceLevel;
  overallCompliance: ComplianceLevel;
}

export interface ComplianceLevel {
  fullyCompliant: number;
  partiallyCompliant: number;
  nonCompliant: number;
  criticalViolation: number;
}

export interface RiskThresholds {
  safetyRisk: RiskLevel;
  regulatoryRisk: RiskLevel;
  formulationRisk: RiskLevel;
  overallRisk: RiskLevel;
}

export interface RiskLevel {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface ProductTypeThresholds {
  skincare: ProductSpecificThresholds;
  haircare: ProductSpecificThresholds;
  makeup: ProductSpecificThresholds;
  fragrance: ProductSpecificThresholds;
  oral_care: ProductSpecificThresholds;
  sun_care: ProductSpecificThresholds;
  personal_care: ProductSpecificThresholds;
}

export interface ProductSpecificThresholds {
  safetyWeight: number;
  regulatoryWeight: number;
  efficacyWeight: number;
  formulationWeight: number;
  minimumSafetyScore: number;
  criticalSafetyConcerns: string[];
}

export interface UserRoleThresholds {
  rd_scientist: RoleSpecificThresholds;
  safety_assessor: RoleSpecificThresholds;
  regulatory_specialist: RoleSpecificThresholds;
  product_manager: RoleSpecificThresholds;
  formulation_chemist: RoleSpecificThresholds;
  quality_assurance: RoleSpecificThresholds;
}

export interface RoleSpecificThresholds {
  primaryDimensions: string[];
  criticalThresholds: Record<string, number>;
  requiredCompliance: string[];
  acceptableRiskLevel: string[];
}

/**
 * Cosmetic Quality Thresholds Service
 */
export class CosmeticQualityThresholdsService {
  private thresholds: CosmeticQualityThresholds;

  constructor() {
    this.thresholds = this.initializeThresholds();
  }

  private initializeThresholds(): CosmeticQualityThresholds {
    return {
      overall: {
        excellent: 0.90,
        good: 0.75,
        acceptable: 0.60,
        minimum: 0.40,
        critical: 0.25
      },
      dimensions: {
        factualAccuracy: {
          excellent: 0.95,
          good: 0.80,
          acceptable: 0.65,
          minimum: 0.45,
          critical: 0.30
        },
        safetyCompliance: {
          excellent: 0.95,
          good: 0.80,
          acceptable: 0.65,
          minimum: 0.50,
          critical: 0.30
        },
        regulatoryCompliance: {
          excellent: 0.95,
          good: 0.85,
          acceptable: 0.70,
          minimum: 0.55,
          critical: 0.35
        },
        formulationAccuracy: {
          excellent: 0.90,
          good: 0.75,
          acceptable: 0.60,
          minimum: 0.45,
          critical: 0.30
        },
        completeness: {
          excellent: 0.90,
          good: 0.75,
          acceptable: 0.60,
          minimum: 0.40,
          critical: 0.25
        },
        clarity: {
          excellent: 0.85,
          good: 0.70,
          acceptable: 0.55,
          minimum: 0.40,
          critical: 0.25
        },
        relevance: {
          excellent: 0.90,
          good: 0.75,
          acceptable: 0.60,
          minimum: 0.45,
          critical: 0.30
        },
        sourceQuality: {
          excellent: 0.90,
          good: 0.75,
          acceptable: 0.60,
          minimum: 0.40,
          critical: 0.25
        }
      },
      cosmeticFactors: {
        ingredientAccuracy: {
          excellent: 0.95,
          good: 0.80,
          acceptable: 0.65,
          minimum: 0.50,
          critical: 0.30
        },
        concentrationGuidelines: {
          excellent: 0.95,
          good: 0.80,
          acceptable: 0.65,
          minimum: 0.50,
          critical: 0.30
        },
        safetyAssessment: {
          excellent: 0.95,
          good: 0.80,
          acceptable: 0.65,
          minimum: 0.55,
          critical: 0.35
        },
        regulatoryStatus: {
          excellent: 0.95,
          good: 0.85,
          acceptable: 0.70,
          minimum: 0.55,
          critical: 0.35
        },
        practicalApplication: {
          excellent: 0.85,
          good: 0.70,
          acceptable: 0.55,
          minimum: 0.40,
          critical: 0.25
        }
      },
      compliance: {
        fdaCompliance: {
          fullyCompliant: 0.95,
          partiallyCompliant: 0.70,
          nonCompliant: 0.40,
          criticalViolation: 0.20
        },
        euCompliance: {
          fullyCompliant: 0.95,
          partiallyCompliant: 0.70,
          nonCompliant: 0.40,
          criticalViolation: 0.20
        },
        aseanCompliance: {
          fullyCompliant: 0.90,
          partiallyCompliant: 0.65,
          nonCompliant: 0.35,
          criticalViolation: 0.20
        },
        overallCompliance: {
          fullyCompliant: 0.90,
          partiallyCompliant: 0.65,
          nonCompliant: 0.35,
          criticalViolation: 0.20
        }
      },
      risk: {
        safetyRisk: {
          low: 0.20,
          medium: 0.50,
          high: 0.80,
          critical: 0.95
        },
        regulatoryRisk: {
          low: 0.15,
          medium: 0.45,
          high: 0.75,
          critical: 0.90
        },
        formulationRisk: {
          low: 0.25,
          medium: 0.55,
          high: 0.85,
          critical: 0.95
        },
        overallRisk: {
          low: 0.20,
          medium: 0.50,
          high: 0.80,
          critical: 0.95
        }
      },
      productTypeSpecific: {
        skincare: {
          safetyWeight: 0.35,
          regulatoryWeight: 0.25,
          efficacyWeight: 0.25,
          formulationWeight: 0.15,
          minimumSafetyScore: 0.70,
          criticalSafetyConcerns: [
            'skin irritation',
            'allergic reactions',
            'photosensitivity',
            'carcinogenicity'
          ]
        },
        haircare: {
          safetyWeight: 0.30,
          regulatoryWeight: 0.25,
          efficacyWeight: 0.30,
          formulationWeight: 0.15,
          minimumSafetyScore: 0.65,
          criticalSafetyConcerns: [
            'scalp irritation',
            'hair damage',
            'eye irritation',
            'allergic reactions'
          ]
        },
        makeup: {
          safetyWeight: 0.40,
          regulatoryWeight: 0.30,
          efficacyWeight: 0.20,
          formulationWeight: 0.10,
          minimumSafetyScore: 0.75,
          criticalSafetyConcerns: [
            'eye irritation',
            'skin sensitization',
            'allergic reactions',
            'heavy metal contamination'
          ]
        },
        fragrance: {
          safetyWeight: 0.45,
          regulatoryWeight: 0.30,
          efficacyWeight: 0.15,
          formulationWeight: 0.10,
          minimumSafetyScore: 0.80,
          criticalSafetyConcerns: [
            'allergic reactions',
            'skin sensitization',
            'respiratory irritation',
            'phototoxicity'
          ]
        },
        oral_care: {
          safetyWeight: 0.40,
          regulatoryWeight: 0.35,
          efficacyWeight: 0.15,
          formulationWeight: 0.10,
          minimumSafetyScore: 0.80,
          criticalSafetyConcerns: [
            'toxicity if ingested',
            'oral mucosa irritation',
            'systemic absorption',
            'microbial contamination'
          ]
        },
        sun_care: {
          safetyWeight: 0.35,
          regulatoryWeight: 0.30,
          efficacyWeight: 0.25,
          formulationWeight: 0.10,
          minimumSafetyScore: 0.75,
          criticalSafetyConcerns: [
            'phototoxicity',
            'skin irritation',
            'environmental impact',
            'systemic absorption'
          ]
        },
        personal_care: {
          safetyWeight: 0.30,
          regulatoryWeight: 0.25,
          efficacyWeight: 0.25,
          formulationWeight: 0.20,
          minimumSafetyScore: 0.65,
          criticalSafetyConcerns: [
            'skin irritation',
            'microbial growth',
            'preservative effectiveness',
            'stability issues'
          ]
        }
      },
      userRoleSpecific: {
        rd_scientist: {
          primaryDimensions: ['factualAccuracy', 'safetyCompliance', 'regulatoryCompliance', 'formulationAccuracy'],
          criticalThresholds: {
            factualAccuracy: 0.70,
            safetyCompliance: 0.65,
            regulatoryCompliance: 0.60,
            formulationAccuracy: 0.65
          },
          requiredCompliance: ['safety_data', 'regulatory_status', 'technical_specifications'],
          acceptableRiskLevel: ['low', 'medium']
        },
        safety_assessor: {
          primaryDimensions: ['safetyCompliance', 'factualAccuracy', 'regulatoryCompliance', 'sourceQuality'],
          criticalThresholds: {
            safetyCompliance: 0.80,
            factualAccuracy: 0.75,
            regulatoryCompliance: 0.70,
            sourceQuality: 0.70
          },
          requiredCompliance: ['comprehensive_safety_assessment', 'toxicity_data', 'regulatory_compliance'],
          acceptableRiskLevel: ['low']
        },
        regulatory_specialist: {
          primaryDimensions: ['regulatoryCompliance', 'factualAccuracy', 'sourceQuality', 'completeness'],
          criticalThresholds: {
            regulatoryCompliance: 0.85,
            factualAccuracy: 0.70,
            sourceQuality: 0.75,
            completeness: 0.70
          },
          requiredCompliance: ['regulatory_status', 'compliance_documentation', 'regional_requirements'],
          acceptableRiskLevel: ['low', 'medium']
        },
        product_manager: {
          primaryDimensions: ['relevance', 'completeness', 'clarity', 'practicalApplication'],
          criticalThresholds: {
            relevance: 0.70,
            completeness: 0.65,
            clarity: 0.60,
            practicalApplication: 0.65
          },
          requiredCompliance: ['market_viability', 'consumer_benefits', 'business_implications'],
          acceptableRiskLevel: ['low', 'medium', 'high']
        },
        formulation_chemist: {
          primaryDimensions: ['formulationAccuracy', 'factualAccuracy', 'practicalApplication', 'ingredientAccuracy'],
          criticalThresholds: {
            formulationAccuracy: 0.75,
            factualAccuracy: 0.70,
            practicalApplication: 0.70,
            ingredientAccuracy: 0.70
          },
          requiredCompliance: ['formulation_guidance', 'compatibility_data', 'stability_information'],
          acceptableRiskLevel: ['low', 'medium']
        },
        quality_assurance: {
          primaryDimensions: ['factualAccuracy', 'sourceQuality', 'completeness', 'regulatoryCompliance'],
          criticalThresholds: {
            factualAccuracy: 0.80,
            sourceQuality: 0.75,
            completeness: 0.75,
            regulatoryCompliance: 0.70
          },
          requiredCompliance: ['quality_standards', 'testing_requirements', 'documentation'],
          acceptableRiskLevel: ['low', 'medium']
        }
      }
    };
  }

  /**
   * Evaluate if a quality score meets thresholds
   */
  evaluateQualityScore(
    score: CosmeticQualityScore,
    context: QualityEvaluationContext
  ): QualityEvaluationResult {
    const overallEvaluation = this.evaluateOverallScore(score.overallScore);
    const dimensionEvaluations = this.evaluateDimensions(score.dimensions, context);
    const cosmeticFactorEvaluations = this.evaluateCosmeticFactors(score.cosmeticSpecificFactors, context);
    const complianceEvaluation = this.evaluateCompliance(score.complianceStatus, context);
    const riskEvaluation = this.evaluateRisk(score.riskAssessment, context);

    const meetsMinimumRequirements = this.checkMinimumRequirements(
      overallEvaluation,
      dimensionEvaluations,
      cosmeticFactorEvaluations,
      complianceEvaluation,
      riskEvaluation,
      context
    );

    const criticalIssues = this.identifyCriticalIssues(
      score,
      overallEvaluation,
      dimensionEvaluations,
      cosmeticFactorEvaluations,
      complianceEvaluation,
      riskEvaluation
    );

    const recommendations = this.generateThresholdBasedRecommendations(
      score,
      overallEvaluation,
      dimensionEvaluations,
      cosmeticFactorEvaluations,
      criticalIssues,
      context
    );

    return {
      overallEvaluation,
      dimensionEvaluations,
      cosmeticFactorEvaluations,
      complianceEvaluation,
      riskEvaluation,
      meetsMinimumRequirements,
      criticalIssues,
      recommendations,
      evaluationContext: context,
      timestamp: new Date()
    };
  }

  private evaluateOverallScore(score: number): ScoreEvaluation {
    const thresholds = this.thresholds.overall;

    let rating: ScoreRating;
    let description: string;

    if (score >= thresholds.excellent) {
      rating = 'excellent';
      description = 'Excellent quality - exceeds expectations';
    } else if (score >= thresholds.good) {
      rating = 'good';
      description = 'Good quality - meets expectations';
    } else if (score >= thresholds.acceptable) {
      rating = 'acceptable';
      description = 'Acceptable quality - meets minimum requirements';
    } else if (score >= thresholds.minimum) {
      rating = 'minimum';
      description = 'Minimum quality - requires improvement';
    } else {
      rating = 'critical';
      description = 'Critical quality issues - immediate attention required';
    }

    return {
      score,
      rating,
      description,
      threshold: thresholds,
      distanceFromThreshold: this.calculateDistanceFromThreshold(score, thresholds),
      meetsMinimum: score >= thresholds.minimum
    };
  }

  private evaluateDimensions(
    dimensions: CosmeticQualityScore['dimensions'],
    context: QualityEvaluationContext
  ): Record<keyof CosmeticQualityScore['dimensions'], ScoreEvaluation> {
    const evaluations: Record<string, ScoreEvaluation> = {};

    Object.entries(dimensions).forEach(([dimension, score]) => {
      const thresholds = this.thresholds.dimensions[dimension as keyof typeof this.thresholds.dimensions];
      evaluations[dimension] = this.evaluateScoreAgainstThresholds(score, thresholds);
    });

    return evaluations as Record<keyof CosmeticQualityScore['dimensions'], ScoreEvaluation>;
  }

  private evaluateCosmeticFactors(
    factors: CosmeticQualityScore['cosmeticSpecificFactors'],
    context: QualityEvaluationContext
  ): Record<keyof CosmeticQualityScore['cosmeticSpecificFactors'], ScoreEvaluation> {
    const evaluations: Record<string, ScoreEvaluation> = {};

    Object.entries(factors).forEach(([factor, score]) => {
      const thresholds = this.thresholds.cosmeticFactors[factor as keyof typeof this.thresholds.cosmeticFactors];
      evaluations[factor] = this.evaluateScoreAgainstThresholds(score, thresholds);
    });

    return evaluations as Record<keyof CosmeticQualityScore['cosmeticSpecificFactors'], ScoreEvaluation>;
  }

  private evaluateCompliance(
    compliance: CosmeticQualityScore['complianceStatus'],
    context: QualityEvaluationContext
  ): ComplianceEvaluation {
    const thresholds = this.thresholds.compliance;

    const fdaEvaluation = this.evaluateComplianceLevel(compliance.fdaCompliant, thresholds.fdaCompliance);
    const euEvaluation = this.evaluateComplianceLevel(compliance.euCompliant, thresholds.euCompliance);
    const aseanEvaluation = this.evaluateComplianceLevel(compliance.aseanCompliant, thresholds.aseanCompliance);

    const overallCompliant = compliance.overallCompliant;
    const overallEvaluation = overallCompliant ?
      this.evaluateScoreAgainstThresholds(1.0, thresholds.overallCompliance) :
      this.evaluateScoreAgainstThresholds(0.0, thresholds.overallCompliance);

    return {
      fda: fdaEvaluation,
      eu: euEvaluation,
      asean: aseanEvaluation,
      overall: overallEvaluation,
      criticalViolations: [
        ...compliance.regulatoryConcerns,
        ...compliance.missingCompliance
      ],
      meetsRequirements: overallCompliant &&
        fdaEvaluation.meetsMinimum &&
        euEvaluation.meetsMinimum &&
        aseanEvaluation.meetsMinimum
    };
  }

  private evaluateRisk(
    risk: CosmeticQualityScore['riskAssessment'],
    context: QualityEvaluationContext
  ): RiskEvaluation {
    const thresholds = this.thresholds.risk;

    const safetyRiskScore = this.calculateRiskScore(risk.safetyRisks);
    const regulatoryRiskScore = this.calculateRiskScore(risk.regulatoryRisks);
    const formulationRiskScore = this.calculateRiskScore(risk.formulationRisks);

    const safetyEvaluation = this.evaluateRiskLevel(safetyRiskScore, thresholds.safetyRisk);
    const regulatoryEvaluation = this.evaluateRiskLevel(regulatoryRiskScore, thresholds.regulatoryRisk);
    const formulationEvaluation = this.evaluateRiskLevel(formulationRiskScore, thresholds.formulationRisk);

    const overallEvaluation = this.evaluateRiskLevel(
      Math.max(safetyRiskScore, regulatoryRiskScore, formulationRiskScore),
      thresholds.overallRisk
    );

    return {
      safety: safetyEvaluation,
      regulatory: regulatoryEvaluation,
      formulation: formulationEvaluation,
      overall: overallEvaluation,
      acceptableForContext: this.isRiskAcceptableForContext(overallEvaluation, context),
      criticalRisks: this.identifyCriticalRisks(risk)
    };
  }

  private evaluateScoreAgainstThresholds(score: number, thresholds: ThresholdLevel): ScoreEvaluation {
    let rating: ScoreRating;
    let description: string;

    if (score >= thresholds.excellent) {
      rating = 'excellent';
      description = 'Excellent - exceeds standards';
    } else if (score >= thresholds.good) {
      rating = 'good';
      description = 'Good - meets standards';
    } else if (score >= thresholds.acceptable) {
      rating = 'acceptable';
      description = 'Acceptable - meets minimum requirements';
    } else if (score >= thresholds.minimum) {
      rating = 'minimum';
      description = 'Minimum - requires improvement';
    } else {
      rating = 'critical';
      description = 'Critical - immediate attention required';
    }

    return {
      score,
      rating,
      description,
      threshold: thresholds,
      distanceFromThreshold: this.calculateDistanceFromThreshold(score, thresholds),
      meetsMinimum: score >= thresholds.minimum
    };
  }

  private evaluateComplianceLevel(isCompliant: boolean, thresholds: ComplianceLevel): ComplianceLevelEvaluation {
    let rating: ComplianceRating;
    let description: string;
    let score: number;

    if (isCompliant) {
      rating = 'fully_compliant';
      description = 'Fully compliant with requirements';
      score = thresholds.fullyCompliant;
    } else {
      rating = 'non_compliant';
      description = 'Non-compliant - action required';
      score = thresholds.nonCompliant;
    }

    return {
      isCompliant,
      rating,
      description,
      score,
      threshold: thresholds,
      meetsMinimum: isCompliant
    };
  }

  private evaluateRiskLevel(riskScore: number, thresholds: RiskLevel): RiskLevelEvaluation {
    let rating: RiskRating;
    let description: string;

    if (riskScore <= thresholds.low) {
      rating = 'low';
      description = 'Low risk - acceptable';
    } else if (riskScore <= thresholds.medium) {
      rating = 'medium';
      description = 'Medium risk - monitor closely';
    } else if (riskScore <= thresholds.high) {
      rating = 'high';
      description = 'High risk - mitigation required';
    } else {
      rating = 'critical';
      description = 'Critical risk - immediate action required';
    }

    return {
      riskScore,
      rating,
      description,
      threshold: thresholds,
      acceptable: rating === 'low' || rating === 'medium'
    };
  }

  private calculateRiskScore(risks: any[]): number {
    if (risks.length === 0) return 0.1; // Low risk if no risks identified

    const severityWeights = {
      low: 0.2,
      medium: 0.5,
      high: 0.8,
      critical: 0.95
    };

    const maxRisk = Math.max(...risks.map(risk =>
      severityWeights[risk.severity as keyof typeof severityWeights] || 0.5
    ));

    return maxRisk;
  }

  private calculateDistanceFromThreshold(score: number, thresholds: ThresholdLevel): number {
    if (score >= thresholds.excellent) {
      return score - thresholds.excellent;
    } else if (score >= thresholds.good) {
      return score - thresholds.good;
    } else if (score >= thresholds.acceptable) {
      return score - thresholds.acceptable;
    } else if (score >= thresholds.minimum) {
      return score - thresholds.minimum;
    } else {
      return score - thresholds.minimum; // Negative distance below minimum
    }
  }

  private checkMinimumRequirements(
    overall: ScoreEvaluation,
    dimensions: Record<string, ScoreEvaluation>,
    cosmeticFactors: Record<string, ScoreEvaluation>,
    compliance: ComplianceEvaluation,
    risk: RiskEvaluation,
    context: QualityEvaluationContext
  ): boolean {
    // Overall score must meet minimum
    if (!overall.meetsMinimum) return false;

    // Safety must always meet minimum for cosmetic products
    if (!dimensions.safetyCompliance.meetsMinimum) return false;

    // Check role-specific critical thresholds
    const roleThresholds = this.thresholds.userRoleSpecific[context.userRole];
    if (roleThresholds) {
      for (const [dimension, threshold] of Object.entries(roleThresholds.criticalThresholds)) {
        const evaluation = dimensions[dimension] || cosmeticFactors[dimension];
        if (evaluation && evaluation.score < threshold) {
          return false;
        }
      }
    }

    // Compliance must be met for target regions
    if (!compliance.meetsRequirements) return false;

    // Risk must be acceptable for context
    if (!risk.acceptableForContext) return false;

    // Product-specific safety requirements
    if (context.productType) {
      const productThresholds = this.thresholds.productTypeSpecific[context.productType];
      if (productThresholds) {
        const safetyScore = dimensions.safetyCompliance.score;
        if (safetyScore < productThresholds.minimumSafetyScore) {
          return false;
        }
      }
    }

    return true;
  }

  private identifyCriticalIssues(
    score: CosmeticQualityScore,
    overall: ScoreEvaluation,
    dimensions: Record<string, ScoreEvaluation>,
    cosmeticFactors: Record<string, ScoreEvaluation>,
    compliance: ComplianceEvaluation,
    risk: RiskEvaluation
  ): CriticalIssue[] {
    const issues: CriticalIssue[] = [];

    // Critical overall score
    if (overall.rating === 'critical') {
      issues.push({
        type: 'overall_quality',
        severity: 'critical',
        description: 'Overall quality score is critically low',
        impact: 'Response may be unreliable and should not be used',
        recommendation: 'Regenerate response or seek alternative sources'
      });
    }

    // Critical safety issues
    if (dimensions.safetyCompliance.rating === 'critical') {
      issues.push({
        type: 'safety',
        severity: 'critical',
        description: 'Safety compliance is critically low',
        impact: 'Potential safety risks for consumers',
        recommendation: 'Immediate safety assessment required before any use'
      });
    }

    // Critical compliance issues
    if (!compliance.meetsRequirements) {
      issues.push({
        type: 'compliance',
        severity: 'critical',
        description: 'Regulatory compliance issues detected',
        impact: 'Product may not meet regulatory requirements',
        recommendation: 'Comprehensive regulatory review required'
      });
    }

    // Critical risk issues
    if (risk.overall.rating === 'critical') {
      issues.push({
        type: 'risk',
        severity: 'critical',
        description: 'Critical risk factors identified',
        impact: 'High potential for adverse outcomes',
        recommendation: 'Immediate risk mitigation required'
      });
    }

    // Critical factual accuracy issues
    if (dimensions.factualAccuracy.rating === 'critical') {
      issues.push({
        type: 'accuracy',
        severity: 'high',
        description: 'Factual accuracy is critically low',
        impact: 'Information may be incorrect or misleading',
        recommendation: 'Verify all facts before use'
      });
    }

    return issues;
  }

  private generateThresholdBasedRecommendations(
    score: CosmeticQualityScore,
    overall: ScoreEvaluation,
    dimensions: Record<string, ScoreEvaluation>,
    cosmeticFactors: Record<string, ScoreEvaluation>,
    criticalIssues: CriticalIssue[],
    context: QualityEvaluationContext
  ): ThresholdRecommendation[] {
    const recommendations: ThresholdRecommendation[] = [];

    // Overall quality recommendations
    if (overall.rating === 'minimum' || overall.rating === 'critical') {
      recommendations.push({
        priority: 'high',
        category: 'overall_quality',
        description: `Overall quality score is ${overall.rating}`,
        actions: [
          'Review and improve all response aspects',
          'Add more credible sources',
          'Enhance factual accuracy',
          'Improve completeness and clarity'
        ]
      });
    }

    // Safety-specific recommendations
    if (dimensions.safetyCompliance.rating !== 'excellent') {
      recommendations.push({
        priority: 'high',
        category: 'safety',
        description: `Safety compliance score is ${dimensions.safetyCompliance.rating}`,
        actions: [
          'Add comprehensive safety assessment',
          'Include toxicity data',
          'Specify concentration limits',
          'Add safety warnings and precautions'
        ]
      });
    }

    // Regulatory compliance recommendations
    if (!score.complianceStatus.overallCompliant) {
      recommendations.push({
        priority: 'high',
        category: 'regulatory',
        description: 'Regulatory compliance issues identified',
        actions: [
          'Verify regulatory status for all regions',
          'Add required documentation information',
          'Check concentration restrictions',
          'Include compliance requirements'
        ]
      });
    }

    // Dimension-specific recommendations
    Object.entries(dimensions).forEach(([dimension, evaluation]) => {
      if (evaluation.rating === 'minimum' || evaluation.rating === 'critical') {
        recommendations.push({
          priority: 'medium',
          category: dimension,
          description: `${dimension} score is ${evaluation.rating}`,
          actions: this.getDimensionImprovementActions(dimension)
        });
      }
    });

    // Role-specific recommendations
    const roleRecommendations = this.getRoleSpecificRecommendations(dimensions, context);
    recommendations.push(...roleRecommendations);

    // Product-type specific recommendations
    if (context.productType) {
      const productRecommendations = this.getProductTypeRecommendations(
        dimensions,
        context.productType,
        score.riskAssessment
      );
      recommendations.push(...productRecommendations);
    }

    return recommendations;
  }

  private getDimensionImprovementActions(dimension: string): string[] {
    const actionMap: Record<string, string[]> = {
      factualAccuracy: [
        'Add specific data and measurements',
        'Include scientific references',
        'Verify claims against reliable sources',
        'Add recent research findings'
      ],
      safetyCompliance: [
        'Include comprehensive safety data',
        'Add toxicology information',
        'Specify concentration limits',
        'Include safety testing results'
      ],
      regulatoryCompliance: [
        'Add regulatory status information',
        'Include specific regulation references',
        'Check regional requirements',
        'Add compliance documentation needs'
      ],
      formulationAccuracy: [
        'Add detailed formulation guidance',
        'Include compatibility information',
        'Add stability considerations',
        'Include pH and solubility data'
      ],
      completeness: [
        'Add missing information components',
        'Include practical examples',
        'Add implementation steps',
        'Cover all relevant aspects'
      ],
      clarity: [
        'Improve structure and organization',
        'Define technical terms',
        'Use clear and concise language',
        'Add section headings'
      ],
      relevance: [
        'Focus on core question',
        'Remove tangential information',
        'Add context-specific examples',
        'Tailor to user needs'
      ],
      sourceQuality: [
        'Add credible source citations',
        'Include peer-reviewed references',
        'Add recent publications',
        'Include regulatory sources'
      ]
    };

    return actionMap[dimension] || ['Review and improve this aspect'];
  }

  private getRoleSpecificRecommendations(
    dimensions: Record<string, ScoreEvaluation>,
    context: QualityEvaluationContext
  ): ThresholdRecommendation[] {
    const recommendations: ThresholdRecommendation[] = [];
    const roleThresholds = this.thresholds.userRoleSpecific[context.userRole];

    if (!roleThresholds) return recommendations;

    // Check critical dimensions for the role
    roleThresholds.primaryDimensions.forEach(dimension => {
      const evaluation = dimensions[dimension];
      if (evaluation && evaluation.score < (roleThresholds.criticalThresholds[dimension] || 0.7)) {
        recommendations.push({
          priority: 'high',
          category: 'role_specific',
          description: `${dimension} is critical for ${context.userRole} role`,
          actions: [
            `Prioritize improvement of ${dimension}`,
            `Add role-specific information for ${dimension}`,
            `Consult ${context.userRole} guidelines`
          ]
        });
      }
    });

    return recommendations;
  }

  private getProductTypeRecommendations(
    dimensions: Record<string, ScoreEvaluation>,
    productType: string,
    riskAssessment: any
  ): ThresholdRecommendation[] {
    const recommendations: ThresholdRecommendation[] = [];
    const productThresholds = this.thresholds.productTypeSpecific[productType as keyof typeof this.thresholds.productTypeSpecific];

    if (!productThresholds) return recommendations;

    // Check for critical safety concerns specific to product type
    const safetyScore = dimensions.safetyCompliance.score;
    if (safetyScore < productThresholds.minimumSafetyScore) {
      recommendations.push({
        priority: 'critical',
        category: 'product_safety',
        description: `Safety score below minimum for ${productType}`,
        actions: [
          'Add comprehensive safety assessment',
          `Address ${productType}-specific safety concerns`,
          'Include appropriate safety warnings',
          'Consider reformulation if necessary'
        ]
      });
    }

    // Check for critical safety concerns in risk assessment
    productThresholds.criticalSafetyConcerns.forEach(concern => {
      const hasConcern = riskAssessment.safetyRisks.some((risk: any) =>
        risk.description.toLowerCase().includes(concern.toLowerCase())
      );

      if (hasConcern) {
        recommendations.push({
          priority: 'critical',
          category: 'critical_safety_concern',
          description: `Critical safety concern: ${concern}`,
          actions: [
            `Address ${concern} immediately`,
            'Conduct additional safety testing',
            'Consider product reformulation',
            'Include strong safety warnings'
          ]
        });
      }
    });

    return recommendations;
  }

  private isRiskAcceptableForContext(riskEvaluation: RiskLevelEvaluation, context: QualityEvaluationContext): boolean {
    const roleThresholds = this.thresholds.userRoleSpecific[context.userRole];

    if (!roleThresholds) {
      return riskEvaluation.acceptable; // Default to standard risk acceptance
    }

    const acceptableRiskLevels = roleThresholds.acceptableRiskLevel;
    return acceptableRiskLevels.includes(riskEvaluation.rating);
  }

  private identifyCriticalRisks(riskAssessment: any): string[] {
    const criticalRisks: string[] = [];

    // Check for critical safety risks
    riskAssessment.safetyRisks?.forEach((risk: any) => {
      if (risk.severity === 'critical') {
        criticalRisks.push(`Safety: ${risk.risk}`);
      }
    });

    // Check for critical regulatory risks
    riskAssessment.regulatoryRisks?.forEach((risk: any) => {
      if (risk.severity === 'critical') {
        criticalRisks.push(`Regulatory: ${risk.risk}`);
      }
    });

    // Check for critical formulation risks
    riskAssessment.formulationRisks?.forEach((risk: any) => {
      if (risk.severity === 'critical') {
        criticalRisks.push(`Formulation: ${risk.risk}`);
      }
    });

    return criticalRisks;
  }

  /**
   * Get threshold configuration for a specific product type
   */
  getProductTypeThresholds(productType: string): ProductSpecificThresholds | undefined {
    return this.thresholds.productTypeSpecific[productType as keyof typeof this.thresholds.productTypeSpecific];
  }

  /**
   * Get threshold configuration for a specific user role
   */
  getUserRoleThresholds(userRole: string): RoleSpecificThresholds | undefined {
    return this.thresholds.userRoleSpecific[userRole as keyof typeof this.thresholds.userRoleSpecific];
  }

  /**
   * Update threshold configuration
   */
  updateThresholds(updates: Partial<CosmeticQualityThresholds>): void {
    this.thresholds = { ...this.thresholds, ...updates };
  }

  /**
   * Get current threshold configuration
   */
  getThresholds(): CosmeticQualityThresholds {
    return { ...this.thresholds };
  }
}

// Supporting interfaces
export interface QualityEvaluationContext {
  userRole: string;
  productType?: string;
  targetRegions: string[];
  queryType: string;
  requirements: {
    requireSafetyData: boolean;
    requireRegulatoryCompliance: boolean;
    requireFormulationGuidance: boolean;
    requireEfficacyData: boolean;
  };
}

export interface QualityEvaluationResult {
  overallEvaluation: ScoreEvaluation;
  dimensionEvaluations: Record<keyof CosmeticQualityScore['dimensions'], ScoreEvaluation>;
  cosmeticFactorEvaluations: Record<keyof CosmeticQualityScore['cosmeticSpecificFactors'], ScoreEvaluation>;
  complianceEvaluation: ComplianceEvaluation;
  riskEvaluation: RiskEvaluation;
  meetsMinimumRequirements: boolean;
  criticalIssues: CriticalIssue[];
  recommendations: ThresholdRecommendation[];
  evaluationContext: QualityEvaluationContext;
  timestamp: Date;
}

export interface ScoreEvaluation {
  score: number;
  rating: ScoreRating;
  description: string;
  threshold: ThresholdLevel;
  distanceFromThreshold: number;
  meetsMinimum: boolean;
}

export type ScoreRating = 'excellent' | 'good' | 'acceptable' | 'minimum' | 'critical';

export interface ComplianceEvaluation {
  fda: ComplianceLevelEvaluation;
  eu: ComplianceLevelEvaluation;
  asean: ComplianceLevelEvaluation;
  overall: ScoreEvaluation;
  criticalViolations: string[];
  meetsRequirements: boolean;
}

export interface ComplianceLevelEvaluation {
  isCompliant: boolean;
  rating: ComplianceRating;
  description: string;
  score: number;
  threshold: ComplianceLevel;
  meetsMinimum: boolean;
}

export type ComplianceRating = 'fully_compliant' | 'partially_compliant' | 'non_compliant' | 'critical_violation';

export interface RiskEvaluation {
  safety: RiskLevelEvaluation;
  regulatory: RiskLevelEvaluation;
  formulation: RiskLevelEvaluation;
  overall: RiskLevelEvaluation;
  acceptableForContext: boolean;
  criticalRisks: string[];
}

export interface RiskLevelEvaluation {
  riskScore: number;
  rating: RiskRating;
  description: string;
  threshold: RiskLevel;
  acceptable: boolean;
}

export type RiskRating = 'low' | 'medium' | 'high' | 'critical';

export interface CriticalIssue {
  type: string;
  severity: 'high' | 'critical';
  description: string;
  impact: string;
  recommendation: string;
}

export interface ThresholdRecommendation {
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  description: string;
  actions: string[];
}