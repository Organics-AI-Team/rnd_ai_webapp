/**
 * Cosmetic Regulatory Database Connections
 * Specialized handlers for FDA, EU CosIng, ASEAN, and other regulatory databases
 */

import { CosmeticKnowledgeResult, CosmeticSearchContext } from '../knowledge/cosmetic-knowledge-sources';

// Regulatory database interfaces
export interface RegulatorySource {
  id: string;
  name: string;
  region: string;
  type: 'government' | 'industry' | 'scientific';
  apiUrl?: string;
  documentationUrl: string;
  updateFrequency: 'realtime' | 'daily' | 'weekly' | 'monthly';
  coverage: RegulatoryCoverage;
  credentials?: {
    apiKey?: string;
    username?: string;
    password?: string;
  };
}

export interface RegulatoryCoverage {
  ingredients: boolean;
  restrictions: boolean;
  safety: boolean;
  compliance: boolean;
  documentation: boolean;
  testing: boolean;
}

export interface RegulatoryData {
  ingredientName: string;
  inCIName?: string;
  casNumber?: string;
  restrictions: RegulatoryRestriction[];
  safetyAssessment: SafetyAssessment;
  complianceStatus: ComplianceStatus;
  requiredDocumentation: string[];
  lastUpdated: Date;
  sources: string[];
}

export interface RegulatoryRestriction {
  region: string;
  maxConcentration?: number;
  minAge?: number;
  productTypeRestrictions: string[];
  prohibitedUses: string[];
  requiredWarnings: string[];
  effectiveDate: Date;
  lastAmended: Date;
}

export interface SafetyAssessment {
  overallSafetyRating: 'safe' | 'caution' | 'restricted' | 'prohibited';
  skinIrritation: SafetyRating;
  eyeIrritation: SafetyRating;
  sensitization: SafetyRating;
  phototoxicity: SafetyRating;
  carcinogenicity: SafetyRating;
  reproductiveToxicity: SafetyRating;
  mutagenicity: SafetyRating;
  notes: string[];
  references: SafetyReference[];
}

export interface SafetyRating {
  rating: 'no_concern' | 'low_concern' | 'moderate_concern' | 'high_concern';
  concentration: number;
  unit: string;
  studyType: string;
  confidence: number;
}

export interface SafetyReference {
  studyId: string;
  title: string;
  authors: string[];
  journal: string;
  year: number;
  doi?: string;
  url?: string;
}

export interface ComplianceStatus {
  fda: RegulatoryCompliance;
  eu: RegulatoryCompliance;
  asean: RegulatoryCompliance;
  china: RegulatoryCompliance;
  japan: RegulatoryCompliance;
  canada: RegulatoryCompliance;
}

export interface RegulatoryCompliance {
  status: 'approved' | 'restricted' | 'prohibited' | 'unknown';
  restrictions: string[];
  requiredTests: string[];
  documentation: string[];
  lastChecked: Date;
}

/**
 * Cosmetic Regulatory Database Service
 */
export class CosmeticRegulatoryService {
  private sources: Map<string, RegulatorySource> = new Map();
  private cache: Map<string, CachedRegulatoryData> = new Map();
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.initializeRegulatorySources();
  }

  private initializeRegulatorySources(): void {
    const regulatorySources: RegulatorySource[] = [
      // FDA (US)
      {
        id: 'fda_cosmetics',
        name: 'FDA Cosmetic Ingredient Database',
        region: 'US',
        type: 'government',
        documentationUrl: 'https://www.fda.gov/cosmetics/cosmetic-ingredient-database',
        updateFrequency: 'weekly',
        coverage: {
          ingredients: true,
          restrictions: true,
          safety: true,
          compliance: true,
          documentation: true,
          testing: true
        }
      },

      // EU CosIng
      {
        id: 'eu_cosing',
        name: 'EU CosIng Database',
        region: 'EU',
        type: 'government',
        documentationUrl: 'https://ec.europa.eu/growth/tools-databases/cosing/',
        updateFrequency: 'weekly',
        coverage: {
          ingredients: true,
          restrictions: true,
          safety: true,
          compliance: true,
          documentation: true,
          testing: false
        }
      },

      // ASEAN Cosmetic Directive
      {
        id: 'asean_cosmetics',
        name: 'ASEAN Cosmetic Ingredient Database',
        region: 'ASEAN',
        type: 'government',
        documentationUrl: 'https://aseancosmetics.org/',
        updateFrequency: 'monthly',
        coverage: {
          ingredients: true,
          restrictions: true,
          safety: false,
          compliance: true,
          documentation: true,
          testing: false
        }
      },

      // Personal Care Products Council (now CTPA)
      {
        id: 'ctpa',
        name: 'CTPA Ingredient Database',
        region: 'UK',
        type: 'industry',
        documentationUrl: 'https://www.ctpa.org.uk/',
        updateFrequency: 'monthly',
        coverage: {
          ingredients: true,
          restrictions: false,
          safety: true,
          compliance: false,
          documentation: true,
          testing: false
        }
      },

      // EWG Skin Deep
      {
        id: 'ewg_skindeep',
        name: 'EWG Skin Deep Database',
        region: 'Global',
        type: 'scientific',
        documentationUrl: 'https://www.ewg.org/skindeep/',
        updateFrequency: 'monthly',
        coverage: {
          ingredients: true,
          restrictions: false,
          safety: true,
          compliance: false,
          documentation: false,
          testing: false
        }
      }
    ];

    regulatorySources.forEach(source => {
      this.sources.set(source.id, source);
    });
  }

  /**
   * Get comprehensive regulatory information for an ingredient
   */
  async getRegulatoryData(
    ingredientName: string,
    context: CosmeticSearchContext
  ): Promise<RegulatoryData> {
    console.log('🔍 [CosmeticRegulatoryService] Getting regulatory data for:', ingredientName);

    // Check cache first
    const cacheKey = this.generateCacheKey(ingredientName, context);
    const cachedData = this.cache.get(cacheKey);

    if (cachedData && this.isCacheValid(cachedData)) {
      console.log('✅ [CosmeticRegulatoryService] Using cached data');
      return cachedData.data;
    }

    // Fetch from all relevant sources
    const relevantSources = this.getRelevantSources(context);
    const regulatoryData = await this.fetchFromAllSources(ingredientName, relevantSources);

    // Cache the result
    this.cache.set(cacheKey, {
      data: regulatoryData,
      timestamp: new Date(),
      key: cacheKey
    });

    console.log('✅ [CosmeticRegulatoryService] Regulatory data retrieved');

    return regulatoryData;
  }

  /**
   * Check compliance across multiple regions
   */
  async checkCompliance(
    ingredientName: string,
    concentration: number,
    productType: string,
    targetRegions: string[]
  ): Promise<ComplianceStatus> {
    console.log('🔍 [CosmeticRegulatoryService] Checking compliance for:', ingredientName);

    const compliance: ComplianceStatus = {
      fda: await this.checkFDACompliance(ingredientName, concentration, productType),
      eu: await this.checkEUCompliance(ingredientName, concentration, productType),
      asean: await this.checkASEANCompliance(ingredientName, concentration, productType),
      china: await this.checkChinaCompliance(ingredientName, concentration, productType),
      japan: await this.checkJapanCompliance(ingredientName, concentration, productType),
      canada: await this.checkCanadaCompliance(ingredientName, concentration, productType)
    };

    console.log('✅ [CosmeticRegulatoryService] Compliance check complete');

    return compliance;
  }

  /**
   * Get safety assessment from multiple sources
   */
  async getSafetyAssessment(
    ingredientName: string,
    concentration: number
  ): Promise<SafetyAssessment> {
    console.log('🔍 [CosmeticRegulatoryService] Getting safety assessment for:', ingredientName);

    // Combine safety data from multiple sources
    const safetyData = await Promise.all([
      this.getFDASafetyData(ingredientName),
      this.getEUSafetyData(ingredientName),
      this.getEWGSafetyData(ingredientName)
    ]);

    // Consolidate safety ratings
    const consolidatedAssessment = this.consolidateSafetyData(safetyData, concentration);

    console.log('✅ [CosmeticRegulatoryService] Safety assessment complete');

    return consolidatedAssessment;
  }

  private getRelevantSources(context: CosmeticSearchContext): RegulatorySource[] {
    const relevantSources: RegulatorySource[] = [];

    // Always include global sources
    this.sources.forEach(source => {
      if (source.region === 'Global') {
        relevantSources.push(source);
      }
    });

    // Add regional sources based on context
    context.targetRegions.forEach(region => {
      const regionalSource = this.findRegionalSource(region);
      if (regionalSource) {
        relevantSources.push(regionalSource);
      }
    });

    return relevantSources;
  }

  private findRegionalSource(region: string): RegulatorySource | undefined {
    const regionMap: Record<string, string> = {
      'us': 'fda_cosmetics',
      'usa': 'fda_cosmetics',
      'united states': 'fda_cosmetics',
      'eu': 'eu_cosing',
      'european union': 'eu_cosing',
      'europe': 'eu_cosing',
      'asean': 'asean_cosmetics',
      'uk': 'ctpa',
      'united kingdom': 'ctpa'
    };

    const sourceId = regionMap[region.toLowerCase()];
    return sourceId ? this.sources.get(sourceId) : undefined;
  }

  private async fetchFromAllSources(
    ingredientName: string,
    sources: RegulatorySource[]
  ): Promise<RegulatoryData> {
    const fetchPromises = sources.map(source =>
      this.fetchFromSource(source, ingredientName)
    );

    const results = await Promise.allSettled(fetchPromises);

    // Consolidate results from all sources
    return this.consolidateRegulatoryData(ingredientName, results, sources);
  }

  private async fetchFromSource(
    source: RegulatorySource,
    ingredientName: string
  ): Promise<Partial<RegulatoryData>> {
    try {
      switch (source.id) {
        case 'fda_cosmetics':
          return await this.fetchFDAData(ingredientName);
        case 'eu_cosing':
          return await this.fetchCosIngData(ingredientName);
        case 'asean_cosmetics':
          return await this.fetchASEANData(ingredientName);
        case 'ctpa':
          return await this.fetchCTPAData(ingredientName);
        case 'ewg_skindeep':
          return await this.fetchEWGData(ingredientName);
        default:
          console.warn(`⚠️ [CosmeticRegulatoryService] Unknown source: ${source.id}`);
          return {};
      }
    } catch (error) {
      console.warn(`⚠️ [CosmeticRegulatoryService] Failed to fetch from ${source.name}:`, error);
      return {};
    }
  }

  private async fetchFDAData(ingredientName: string): Promise<Partial<RegulatoryData>> {
    // Simulate FDA database lookup
    // In a real implementation, this would call the FDA API or database

    return {
      restrictions: [
        {
          region: 'US',
          maxConcentration: 25, // Example: 25% for leave-on products
          productTypeRestrictions: ['rinse-off', 'leave-on'],
          requiredWarnings: ['For external use only'],
          effectiveDate: new Date('2020-01-01'),
          lastAmended: new Date('2023-06-01')
        }
      ],
      safetyAssessment: {
        overallSafetyRating: 'safe',
        skinIrritation: { rating: 'low_concern', concentration: 25, unit: '%', studyType: 'Human patch test', confidence: 0.8 },
        eyeIrritation: { rating: 'moderate_concern', concentration: 10, unit: '%', studyType: 'In vitro', confidence: 0.7 },
        sensitization: { rating: 'low_concern', concentration: 25, unit: '%', studyType: 'Human LLNA', confidence: 0.8 },
        phototoxicity: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'In vitro 3T3 NRU', confidence: 0.9 },
        carcinogenicity: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Animal study', confidence: 0.8 },
        reproductiveToxicity: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Animal study', confidence: 0.7 },
        mutagenicity: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Ames test', confidence: 0.9 },
        notes: ['Generally recognized as safe for cosmetic use'],
        references: []
      },
      complianceStatus: {
        fda: { status: 'approved', restrictions: [], requiredTests: [], documentation: [], lastChecked: new Date() }
      },
      requiredDocumentation: ['Safety Data Sheet', 'Certificate of Analysis'],
      lastUpdated: new Date(),
      sources: ['FDA Cosmetic Ingredient Database']
    };
  }

  private async fetchCosIngData(ingredientName: string): Promise<Partial<RegulatoryData>> {
    // Simulate CosIng database lookup
    // In a real implementation, this would parse the CosIng database

    return {
      inCIName: ingredientName,
      restrictions: [
        {
          region: 'EU',
          maxConcentration: 10, // EU-specific limit
          productTypeRestrictions: ['leave-on'],
          prohibitedUses: ['oral products', 'lip products'],
          requiredWarnings: ['Avoid contact with eyes'],
          effectiveDate: new Date('2019-11-10'),
          lastAmended: new Date('2023-09-15')
        }
      ],
      safetyAssessment: {
        overallSafetyRating: 'restricted',
        skinIrritation: { rating: 'moderate_concern', concentration: 10, unit: '%', studyType: 'Human patch test', confidence: 0.9 },
        eyeIrritation: { rating: 'high_concern', concentration: 5, unit: '%', studyType: 'In vitro', confidence: 0.8 },
        sensitization: { rating: 'moderate_concern', concentration: 10, unit: '%', studyType: 'Human LLNA', confidence: 0.9 },
        phototoxicity: { rating: 'low_concern', concentration: 50, unit: '%', studyType: 'In vitro 3T3 NRU', confidence: 0.8 },
        carcinogenicity: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Animal study', confidence: 0.9 },
        reproductiveToxicity: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Animal study', confidence: 0.8 },
        mutagenicity: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Ames test', confidence: 0.9 },
        notes: ['Restricted for use in certain product types'],
        references: []
      },
      complianceStatus: {
        eu: { status: 'restricted', restrictions: ['Max 10% in leave-on products'], requiredTests: ['Eye irritation test'], documentation: ['Safety Assessment'], lastChecked: new Date() }
      },
      requiredDocumentation: ['EU Safety Assessment', 'Toxicological Dossier'],
      lastUpdated: new Date(),
      sources: ['EU CosIng Database']
    };
  }

  private async fetchASEANData(ingredientName: string): Promise<Partial<RegulatoryData>> {
    // Simulate ASEAN database lookup

    return {
      restrictions: [
        {
          region: 'ASEAN',
          maxConcentration: 20,
          productTypeRestrictions: ['all cosmetic products'],
          requiredWarnings: ['Use as directed'],
          effectiveDate: new Date('2021-01-01'),
          lastAmended: new Date('2023-07-01')
        }
      ],
      complianceStatus: {
        // ASEAN compliance would be calculated based on member country regulations
      },
      requiredDocumentation: ['ASEAN Cosmetic Notification File'],
      lastUpdated: new Date(),
      sources: ['ASEAN Cosmetic Directive']
    };
  }

  private async fetchCTPAData(ingredientName: string): Promise<Partial<RegulatoryData>> {
    // Simulate CTPA database lookup
    return {
      safetyAssessment: {
        overallSafetyRating: 'safe',
        notes: ['UK industry assessment'],
        references: []
      },
      lastUpdated: new Date(),
      sources: ['CTPA Database']
    };
  }

  private async fetchEWGData(ingredientName: string): Promise<Partial<RegulatoryData>> {
    // Simulate EWG Skin Deep lookup
    return {
      safetyAssessment: {
        overallSafetyRating: 'caution',
        notes: ['EWG rating based on available data'],
        references: []
      },
      lastUpdated: new Date(),
      sources: ['EWG Skin Deep']
    };
  }

  private consolidateRegulatoryData(
    ingredientName: string,
    results: PromiseSettledResult<Partial<RegulatoryData>>[],
    sources: RegulatorySource[]
  ): RegulatoryData {
    // Initialize with default values
    const consolidatedData: RegulatoryData = {
      ingredientName,
      restrictions: [],
      safetyAssessment: this.getDefaultSafetyAssessment(),
      complianceStatus: this.getDefaultComplianceStatus(),
      requiredDocumentation: [],
      lastUpdated: new Date(),
      sources: []
    };

    // Process results from each source
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const sourceData = result.value;
        const source = sources[index];

        // Merge restrictions
        if (sourceData.restrictions) {
          consolidatedData.restrictions.push(...sourceData.restrictions);
        }

        // Merge safety assessment
        if (sourceData.safetyAssessment) {
          consolidatedData.safetyAssessment = this.mergeSafetyAssessments(
            consolidatedData.safetyAssessment,
            sourceData.safetyAssessment
          );
        }

        // Merge compliance status
        if (sourceData.complianceStatus) {
          consolidatedData.complianceStatus = this.mergeComplianceStatus(
            consolidatedData.complianceStatus,
            sourceData.complianceStatus
          );
        }

        // Merge required documentation
        if (sourceData.requiredDocumentation) {
          consolidatedData.requiredDocumentation.push(...sourceData.requiredDocumentation);
        }

        // Add source
        if (sourceData.sources) {
          consolidatedData.sources.push(...sourceData.sources);
        } else {
          consolidatedData.sources.push(source.name);
        }

        // Update lastUpdated if more recent
        if (sourceData.lastUpdated && sourceData.lastUpdated > consolidatedData.lastUpdated) {
          consolidatedData.lastUpdated = sourceData.lastUpdated;
        }

        // Add INCI name if available
        if (sourceData.inCIName) {
          consolidatedData.inCIName = sourceData.inCIName;
        }

        // Add CAS number if available
        if (sourceData.casNumber) {
          consolidatedData.casNumber = sourceData.casNumber;
        }
      }
    });

    // Remove duplicates
    consolidatedData.requiredDocumentation = [...new Set(consolidatedData.requiredDocumentation)];
    consolidatedData.sources = [...new Set(consolidatedData.sources)];

    return consolidatedData;
  }

  private mergeSafetyAssessments(
    base: SafetyAssessment,
    additional: Partial<SafetyAssessment>
  ): SafetyAssessment {
    const merged: SafetyAssessment = { ...base };

    // Use the most conservative safety rating
    if (additional.overallSafetyRating) {
      merged.overallSafetyRating = this.getMostConservativeRating(
        base.overallSafetyRating,
        additional.overallSafetyRating
      );
    }

    // Merge individual safety ratings
    const ratingFields: Array<keyof SafetyAssessment> = [
      'skinIrritation', 'eyeIrritation', 'sensitization',
      'phototoxicity', 'carcinogenicity', 'reproductiveToxicity', 'mutagenicity'
    ];

    ratingFields.forEach(field => {
      if (additional[field]) {
        merged[field] = this.mergeSafetyRating(
          base[field] as SafetyRating,
          additional[field] as SafetyRating
        );
      }
    });

    // Merge notes and references
    if (additional.notes) {
      merged.notes.push(...additional.notes);
    }

    if (additional.references) {
      merged.references.push(...additional.references);
    }

    // Remove duplicates
    merged.notes = [...new Set(merged.notes)];
    merged.references = [...new Set(merged.references)];

    return merged;
  }

  private getMostConservativeRating(
    rating1: SafetyAssessment['overallSafetyRating'],
    rating2: SafetyAssessment['overallSafetyRating']
  ): SafetyAssessment['overallSafetyRating'] {
    const ratingOrder = ['safe', 'caution', 'restricted', 'prohibited'];

    const index1 = ratingOrder.indexOf(rating1);
    const index2 = ratingOrder.indexOf(rating2);

    return index2 > index1 ? rating2 : rating1;
  }

  private mergeSafetyRating(rating1: SafetyRating, rating2: SafetyRating): SafetyRating {
    // Use the more conservative rating
    const ratingOrder = ['no_concern', 'low_concern', 'moderate_concern', 'high_concern'];

    const index1 = ratingOrder.indexOf(rating1.rating);
    const index2 = ratingOrder.indexOf(rating2.rating);

    const moreConservative = index2 > index1 ? rating2 : rating1;

    return {
      ...moreConservative,
      // Use lower concentration for safety
      concentration: Math.min(rating1.concentration, rating2.concentration)
    };
  }

  private mergeComplianceStatus(
    base: ComplianceStatus,
    additional: Partial<ComplianceStatus>
  ): ComplianceStatus {
    return {
      fda: additional.fda || base.fda,
      eu: additional.eu || base.eu,
      asean: additional.asean || base.asean,
      china: additional.china || base.china,
      japan: additional.japan || base.japan,
      canada: additional.canada || base.canada
    };
  }

  private async checkFDACompliance(
    ingredientName: string,
    concentration: number,
    productType: string
  ): Promise<RegulatoryCompliance> {
    const regulatoryData = await this.getRegulatoryData(ingredientName, {
      region: 'US',
      targetRegions: ['US'],
      requireLatestInfo: true,
      originalQuery: ''
    });

    const fdaRestriction = regulatoryData.restrictions.find(r => r.region === 'US');

    let status: RegulatoryCompliance['status'] = 'approved';
    const restrictions: string[] = [];

    if (fdaRestriction) {
      if (fdaRestriction.maxConcentration && concentration > fdaRestriction.maxConcentration) {
        status = 'restricted';
        restrictions.push(`Concentration exceeds FDA limit of ${fdaRestriction.maxConcentration}%`);
      }

      if (fdaRestriction.productTypeRestrictions.length > 0) {
        restrictions.push(`Approved for: ${fdaRestriction.productTypeRestrictions.join(', ')}`);
      }
    }

    return {
      status,
      restrictions,
      requiredTests: regulatoryData.safetyAssessment.overallSafetyRating !== 'safe' ?
        ['Safety assessment required'] : [],
      documentation: ['Safety Data Sheet'],
      lastChecked: new Date()
    };
  }

  private async checkEUCompliance(
    ingredientName: string,
    concentration: number,
    productType: string
  ): Promise<RegulatoryCompliance> {
    const regulatoryData = await this.getRegulatoryData(ingredientName, {
      region: 'EU',
      targetRegions: ['EU'],
      requireLatestInfo: true,
      originalQuery: ''
    });

    const euRestriction = regulatoryData.restrictions.find(r => r.region === 'EU');

    let status: RegulatoryCompliance['status'] = 'approved';
    const restrictions: string[] = [];

    if (euRestriction) {
      if (euRestriction.maxConcentration && concentration > euRestriction.maxConcentration) {
        status = 'restricted';
        restrictions.push(`Concentration exceeds EU limit of ${euRestriction.maxConcentration}%`);
      }

      if (euRestriction.prohibitedUses.includes(productType)) {
        status = 'prohibited';
        restrictions.push(`Prohibited for use in ${productType}`);
      }
    }

    return {
      status,
      restrictions,
      requiredTests: ['EU safety assessment'],
      documentation: ['EU Cosmetic Product Safety Report'],
      lastChecked: new Date()
    };
  }

  private async checkASEANCompliance(
    ingredientName: string,
    concentration: number,
    productType: string
  ): Promise<RegulatoryCompliance> {
    // Similar to FDA/EU checks but for ASEAN requirements
    return {
      status: 'approved',
      restrictions: [],
      requiredTests: ['ASEAN safety assessment'],
      documentation: ['ASEAN Cosmetic Notification File'],
      lastChecked: new Date()
    };
  }

  private async checkChinaCompliance(
    ingredientName: string,
    concentration: number,
    productType: string
  ): Promise<RegulatoryCompliance> {
    return {
      status: 'unknown',
      restrictions: ['China compliance verification required'],
      requiredTests: ['China-specific safety testing'],
      documentation: ['China cosmetic registration'],
      lastChecked: new Date()
    };
  }

  private async checkJapanCompliance(
    ingredientName: string,
    concentration: number,
    productType: string
  ): Promise<RegulatoryCompliance> {
    return {
      status: 'unknown',
      restrictions: ['Japan compliance verification required'],
      requiredTests: ['Japan-specific safety testing'],
      documentation: ['Japan cosmetic notification'],
      lastChecked: new Date()
    };
  }

  private async checkCanadaCompliance(
    ingredientName: string,
    concentration: number,
    productType: string
  ): Promise<RegulatoryCompliance> {
    return {
      status: 'unknown',
      restrictions: ['Canada compliance verification required'],
      requiredTests: ['Canada-specific safety testing'],
      documentation: ['Canada cosmetic notification'],
      lastChecked: new Date()
    };
  }

  private async getFDASafetyData(ingredientName: string): Promise<Partial<RegulatoryData>> {
    return await this.fetchFDAData(ingredientName);
  }

  private async getEUSafetyData(ingredientName: string): Promise<Partial<RegulatoryData>> {
    return await this.fetchCosIngData(ingredientName);
  }

  private async getEWGSafetyData(ingredientName: string): Promise<Partial<RegulatoryData>> {
    return await this.fetchEWGData(ingredientName);
  }

  private consolidateSafetyData(
    safetyData: Partial<RegulatoryData>[],
    concentration: number
  ): SafetyAssessment {
    const safetyAssessments = safetyData
      .filter(data => data.safetyAssessment)
      .map(data => data.safetyAssessment!);

    if (safetyAssessments.length === 0) {
      return this.getDefaultSafetyAssessment();
    }

    return safetyAssessments.reduce((merged, current) =>
      this.mergeSafetyAssessments(merged, current)
    );
  }

  private getDefaultSafetyAssessment(): SafetyAssessment {
    return {
      overallSafetyRating: 'unknown',
      skinIrritation: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Not specified', confidence: 0 },
      eyeIrritation: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Not specified', confidence: 0 },
      sensitization: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Not specified', confidence: 0 },
      phototoxicity: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Not specified', confidence: 0 },
      carcinogenicity: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Not specified', confidence: 0 },
      reproductiveToxicity: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Not specified', confidence: 0 },
      mutagenicity: { rating: 'no_concern', concentration: 100, unit: '%', studyType: 'Not specified', confidence: 0 },
      notes: ['Safety assessment not available'],
      references: []
    };
  }

  private getDefaultComplianceStatus(): ComplianceStatus {
    const defaultCompliance: RegulatoryCompliance = {
      status: 'unknown',
      restrictions: ['Compliance verification required'],
      requiredTests: [],
      documentation: [],
      lastChecked: new Date()
    };

    return {
      fda: { ...defaultCompliance },
      eu: { ...defaultCompliance },
      asean: { ...defaultCompliance },
      china: { ...defaultCompliance },
      japan: { ...defaultCompliance },
      canada: { ...defaultCompliance }
    };
  }

  private generateCacheKey(ingredientName: string, context: CosmeticSearchContext): string {
    return `${ingredientName.toLowerCase()}_${context.targetRegions.join('_')}`;
  }

  private isCacheValid(cachedData: CachedRegulatoryData): boolean {
    const now = new Date();
    const cacheAge = now.getTime() - cachedData.timestamp.getTime();
    return cacheAge < this.CACHE_DURATION;
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache(): void {
    const now = new Date();

    for (const [key, data] of this.cache.entries()) {
      const cacheAge = now.getTime() - data.timestamp.getTime();
      if (cacheAge > this.CACHE_DURATION) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const totalEntries = this.cache.size;
    const expiredEntries = Array.from(this.cache.values()).filter(data =>
      !this.isCacheValid(data)
    ).length;

    return {
      totalEntries,
      validEntries: totalEntries - expiredEntries,
      expiredEntries,
      cacheHitRate: 0 // Would need to track actual usage to calculate
    };
  }
}

// Internal interfaces
interface CachedRegulatoryData {
  data: RegulatoryData;
  timestamp: Date;
  key: string;
}

interface CacheStats {
  totalEntries: number;
  validEntries: number;
  expiredEntries: number;
  cacheHitRate: number;
}