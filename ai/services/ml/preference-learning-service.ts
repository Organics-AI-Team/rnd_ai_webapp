/**
 * TensorFlow.js User Preference Learning Service
 * Implements ML-based user preference learning and personalization
 */

import * as tf from '@tensorflow/tfjs';
import { UserPreferences } from '../enhanced/enhanced-ai-service';

interface UserInteraction {
  userId: string;
  prompt: string;
  response: string;
  feedback: {
    type: string;
    score: number;
    timestamp: Date;
  };
  context: {
    category: string;
    complexity: string;
    expertiseLevel: string;
  };
  embeddings?: tf.Tensor;
}

interface PreferenceFeatures {
  // Text features (simplified embeddings)
  promptLength: number;
  responseLength: number;
  technicalTermsCount: number;
  questionMarksCount: number;

  // User behavior features
  averageFeedbackScore: number;
  preferredLengthScore: number; // 0: concise, 0.5: medium, 1: detailed
  preferredComplexityScore: number; // 0: basic, 0.5: intermediate, 1: advanced
  preferredStyleScore: number; // 0: formal, 0.5: casual, 1: technical

  // Context features
  categoryFeatures: number[]; // One-hot encoded categories
  timeOfDay: number; // 0-23
  interactionCount: number;
}

/**
 * TensorFlow.js-based preference learning service
 */
export class PreferenceLearningService {
  private preferenceModel: tf.LayersModel | null = null;
  private embeddingModel: tf.LayersModel | null = null;
  private userInteractionHistory: Map<string, UserInteraction[]> = new Map();
  private isInitialized = false;

  // Feature dimensions
  private readonly FEATURE_DIMENSIONS = 20;
  private readonly EMBEDDING_DIM = 50;
  private readonly CATEGORY_COUNT = 6; // ingredients, formulations, regulations, research, applications, general

  constructor() {
    this.initializeModels();
  }

  /**
   * Initialize TensorFlow.js models
   */
  private async initializeModels(): Promise<void> {
    try {
      console.log('🧠 [PreferenceLearning] Initializing TensorFlow.js models...');

      // Initialize embedding model for text features
      this.embeddingModel = this.createEmbeddingModel();

      // Initialize preference prediction model
      this.preferenceModel = this.createPreferenceModel();

      this.isInitialized = true;
      console.log('✅ [PreferenceLearning] Models initialized successfully');
    } catch (error) {
      console.error('❌ [PreferenceLearning] Failed to initialize models:', error);
    }
  }

  /**
   * Create embedding model for text processing
   */
  private createEmbeddingModel(): tf.LayersModel {
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [100], // Max sequence length
          units: this.EMBEDDING_DIM,
          activation: 'relu',
          name: 'text_embedding',
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({
          units: this.EMBEDDING_DIM,
          activation: 'relu',
          name: 'text_features',
        }),
      ],
    });

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError',
      metrics: ['accuracy'],
    });

    return model;
  }

  /**
   * Create preference prediction model
   */
  private createPreferenceModel(): tf.LayersModel {
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [this.FEATURE_DIMENSIONS],
          units: 64,
          activation: 'relu',
          name: 'hidden_1',
        }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.3 }),

        tf.layers.dense({
          units: 32,
          activation: 'relu',
          name: 'hidden_2',
        }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.2 }),

        tf.layers.dense({
          units: 16,
          activation: 'relu',
          name: 'hidden_3',
        }),

        // Output layers for different preference aspects
        tf.layers.dense({
          units: 3, // concise, medium, detailed
          activation: 'softmax',
          name: 'length_preference',
        }),
      ],
    });

    // Multi-output model for different preference types
    const lengthOutput = model.getLayer('length_preference').output;

    const multiOutputModel = tf.model({
      inputs: model.inputs,
      outputs: {
        length_preference: lengthOutput,
      },
    });

    multiOutputModel.compile({
      optimizer: tf.train.adam(0.001),
      loss: {
        length_preference: 'categoricalCrossentropy',
      },
      metrics: {
        length_preference: 'accuracy',
      },
    });

    return multiOutputModel as tf.LayersModel;
  }

  /**
   * Record user interaction for learning
   */
  async recordInteraction(interaction: UserInteraction): Promise<void> {
    if (!this.isInitialized) {
      await this.initializeModels();
    }

    // Store interaction
    const history = this.userInteractionHistory.get(interaction.userId) || [];
    history.push(interaction);

    // Keep only last 100 interactions per user
    if (history.length > 100) {
      history.shift();
    }

    this.userInteractionHistory.set(interaction.userId, history);

    // Train model with new interaction
    await this.trainOnInteraction(interaction);

    console.log(`📊 [PreferenceLearning] Recorded interaction for user ${interaction.userId}`);
  }

  /**
   * Train model on new interaction
   */
  private async trainOnInteraction(interaction: UserInteraction): Promise<void> {
    if (!this.preferenceModel || !this.embeddingModel) return;

    try {
      // Extract features
      const features = this.extractFeatures(interaction);
      const featuresTensor = tf.tensor2d([features], [1, this.FEATURE_DIMENSIONS]);

      // Create labels based on feedback
      const labels = this.createLabels(interaction);

      // Train the model
      await this.preferenceModel.fit(featuresTensor, labels, {
        epochs: 1,
        batchSize: 1,
        verbose: 0,
      });

      // Clean up tensors
      featuresTensor.dispose();
      Object.values(labels).forEach(tensor => tensor.dispose());

      console.log('🎯 [PreferenceLearning] Model updated with new interaction');
    } catch (error) {
      console.error('❌ [PreferenceLearning] Training failed:', error);
    }
  }

  /**
   * Extract features from user interaction
   */
  private extractFeatures(interaction: UserInteraction): number[] {
    const features: PreferenceFeatures = {
      // Text features
      promptLength: interaction.prompt.length,
      responseLength: interaction.response.length,
      technicalTermsCount: this.countTechnicalTerms(interaction.prompt + ' ' + interaction.response),
      questionMarksCount: (interaction.prompt.match(/\?/g) || []).length,

      // User behavior features (from history)
      averageFeedbackScore: this.calculateAverageFeedback(interaction.userId),
      preferredLengthScore: this.inferLengthPreference(interaction),
      preferredComplexityScore: this.inferComplexityPreference(interaction),
      preferredStyleScore: this.inferStylePreference(interaction),

      // Context features
      categoryFeatures: this.encodeCategory(interaction.context.category),
      timeOfDay: new Date().getHours(),
      interactionCount: this.userInteractionHistory.get(interaction.userId)?.length || 0,
    };

    return this.flattenFeatures(features);
  }

  /**
   * Count technical terms in text
   */
  private countTechnicalTerms(text: string): number {
    const technicalTerms = [
      'mechanism', 'synthesis', 'molecular', 'chemical', 'biological',
      'formulation', 'ingredient', 'compound', 'extraction', 'antioxidant',
      'preservative', 'emulsion', 'stability', 'toxicity', 'efficacy'
    ];

    return technicalTerms.filter(term =>
      text.toLowerCase().includes(term)
    ).length;
  }

  /**
   * Calculate average feedback score for user
   */
  private calculateAverageFeedback(userId: string): number {
    const history = this.userInteractionHistory.get(userId) || [];
    if (history.length === 0) return 0.5; // Default neutral score

    const totalScore = history.reduce((sum, interaction) =>
      sum + interaction.feedback.score, 0
    );

    return totalScore / history.length;
  }

  /**
   * Infer length preference from interaction
   */
  private inferLengthPreference(interaction: UserInteraction): number {
    if (interaction.feedback.type === 'too_long') return 0.2; // concise
    if (interaction.feedback.type === 'too_short') return 0.8; // detailed

    // Infer from response length and feedback
    const responseLength = interaction.response.length;
    if (responseLength < 200) return 0.2; // concise
    if (responseLength > 800) return 0.8; // detailed
    return 0.5; // medium
  }

  /**
   * Infer complexity preference from interaction
   */
  private inferComplexityPreference(interaction: UserInteraction): number {
    const technicalTerms = this.countTechnicalTerms(interaction.response);
    const totalWords = interaction.response.split(/\s+/).length;
    const technicalRatio = technicalTerms / totalWords;

    if (interaction.feedback.score >= 4 && technicalRatio > 0.1) return 0.8; // advanced
    if (interaction.feedback.type === 'unclear') return 0.2; // basic
    return 0.5; // intermediate
  }

  /**
   * Infer style preference from interaction
   */
  private inferStylePreference(interaction: UserInteraction): number {
    const prompt = interaction.prompt.toLowerCase();

    // Check for formal indicators
    if (prompt.includes('please') || prompt.includes('could you')) return 0.2; // formal

    // Check for technical indicators
    if (this.countTechnicalTerms(prompt) > 2) return 0.8; // technical

    return 0.5; // casual
  }

  /**
   * Encode category as one-hot vector
   */
  private encodeCategory(category: string): number[] {
    const categories = ['ingredients', 'formulations', 'regulations', 'research', 'applications', 'general'];
    const encoding = new Array(this.CATEGORY_COUNT).fill(0);
    const index = categories.indexOf(category);
    if (index !== -1) encoding[index] = 1;
    return encoding;
  }

  /**
   * Flatten feature object to array
   */
  private flattenFeatures(features: PreferenceFeatures): number[] {
    return [
      features.promptLength,
      features.responseLength,
      features.technicalTermsCount,
      features.questionMarksCount,
      features.averageFeedbackScore,
      features.preferredLengthScore,
      features.preferredComplexityScore,
      features.preferredStyleScore,
      ...features.categoryFeatures,
      features.timeOfDay / 24, // Normalize
      Math.min(features.interactionCount / 100, 1), // Normalize
    ];
  }

  /**
   * Create training labels from interaction
   */
  private createLabels(interaction: UserInteraction): Record<string, tf.Tensor> {
    // Length preference labels
    const lengthPreference = [0, 0, 0]; // [concise, medium, detailed]
    const lengthScore = this.inferLengthPreference(interaction);

    if (lengthScore < 0.33) lengthPreference[0] = 1; // concise
    else if (lengthScore < 0.67) lengthPreference[1] = 1; // medium
    else lengthPreference[2] = 1; // detailed

    return {
      length_preference: tf.tensor2d([lengthPreference], [1, 3]),
    };
  }

  /**
   * Predict user preferences based on history
   */
  async predictPreferences(userId: string, currentContext: any): Promise<Partial<UserPreferences>> {
    if (!this.isInitialized || !this.preferenceModel) {
      await this.initializeModels();
    }

    const history = this.userInteractionHistory.get(userId) || [];
    if (history.length === 0) {
      return this.getDefaultPreferences();
    }

    try {
      // Create a synthetic interaction for prediction
      const latestInteraction = history[history.length - 1];
      const syntheticInteraction: UserInteraction = {
        ...latestInteraction,
        context: currentContext,
        feedback: { ...latestInteraction.feedback, score: 5 }, // Assume positive for prediction
      };

      const features = this.extractFeatures(syntheticInteraction);
      const featuresTensor = tf.tensor2d([features], [1, this.FEATURE_DIMENSIONS]);

      const prediction = this.preferenceModel.predict(featuresTensor) as tf.Tensor;
      const predictionData = await prediction.data();

      featuresTensor.dispose();
      prediction.dispose();

      return this.interpretPrediction(predictionData);
    } catch (error) {
      console.error('❌ [PreferenceLearning] Prediction failed:', error);
      return this.getDefaultPreferences();
    }
  }

  /**
   * Interpret model prediction
   */
  private interpretPrediction(predictionData: Float32Array): Partial<UserPreferences> {
    const [conciseScore, mediumScore, detailedScore] = predictionData;

    let preferredLength: 'concise' | 'medium' | 'detailed' = 'medium';
    if (conciseScore > Math.max(mediumScore, detailedScore)) preferredLength = 'concise';
    else if (detailedScore > Math.max(conciseScore, mediumScore)) preferredLength = 'detailed';

    return {
      preferredLength,
      preferredStyle: 'casual', // Could be enhanced with style prediction
      preferredComplexity: 'intermediate', // Could be enhanced with complexity prediction
      expertiseLevel: 'intermediate',
    };
  }

  /**
   * Get default preferences for new users
   */
  private getDefaultPreferences(): Partial<UserPreferences> {
    return {
      preferredLength: 'medium',
      preferredStyle: 'casual',
      preferredComplexity: 'intermediate',
      expertiseLevel: 'intermediate',
      language: 'en',
      interests: [],
    };
  }

  /**
   * Get learning statistics
   */
  getLearningStats(userId: string): {
    interactionCount: number;
    averageFeedbackScore: number;
    preferredCategories: string[];
    improvementTrend: number;
  } {
    const history = this.userInteractionHistory.get(userId) || [];

    if (history.length === 0) {
      return {
        interactionCount: 0,
        averageFeedbackScore: 0,
        preferredCategories: [],
        improvementTrend: 0,
      };
    }

    // Calculate average feedback
    const totalScore = history.reduce((sum, interaction) =>
      sum + interaction.feedback.score, 0
    );
    const averageFeedbackScore = totalScore / history.length;

    // Find preferred categories
    const categoryCounts = history.reduce((counts, interaction) => {
      counts[interaction.context.category] = (counts[interaction.context.category] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    const preferredCategories = Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([category]) => category);

    // Calculate improvement trend (last 10 vs previous)
    const recentFeedback = history.slice(-10).map(i => i.feedback.score);
    const previousFeedback = history.slice(-20, -10).map(i => i.feedback.score);

    const recentAverage = recentFeedback.length > 0
      ? recentFeedback.reduce((sum, score) => sum + score, 0) / recentFeedback.length
      : 0;

    const previousAverage = previousFeedback.length > 0
      ? previousFeedback.reduce((sum, score) => sum + score, 0) / previousFeedback.length
      : 0;

    const improvementTrend = recentAverage - previousAverage;

    return {
      interactionCount: history.length,
      averageFeedbackScore,
      preferredCategories,
      improvementTrend,
    };
  }

  /**
   * Export model for persistence
   */
  async exportModel(): Promise<Uint8Array | null> {
    if (!this.preferenceModel) return null;

    try {
      const modelData = await this.preferenceModel.save('localstorage://preference-model');
      console.log('💾 [PreferenceLearning] Model exported successfully');
      return null; // Model saved to localStorage
    } catch (error) {
      console.error('❌ [PreferenceLearning] Model export failed:', error);
      return null;
    }
  }

  /**
   * Import saved model
   */
  async importModel(): Promise<boolean> {
    try {
      this.preferenceModel = await tf.loadLayersModel('localstorage://preference-model');
      console.log('📥 [PreferenceLearning] Model imported successfully');
      return true;
    } catch (error) {
      console.error('❌ [PreferenceLearning] Model import failed:', error);
      return false;
    }
  }

  /**
   * Cleanup tensors and models
   */
  dispose(): void {
    if (this.preferenceModel) {
      this.preferenceModel.dispose();
      this.preferenceModel = null;
    }
    if (this.embeddingModel) {
      this.embeddingModel.dispose();
      this.embeddingModel = null;
    }
    console.log('🧹 [PreferenceLearning] Models disposed');
  }
}