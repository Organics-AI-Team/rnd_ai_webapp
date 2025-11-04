import { IAIService, IAIServiceFactory } from './ai-service-interface';
import { OpenAIService } from '../providers/openai-service';
import { GeminiService } from '../providers/gemini-service';
import { LangChainService } from '../providers/langchain-service';
import { AIServiceConfig } from '../../types/ai-types';

/**
 * Factory for creating AI service instances
 * Provides a unified interface for creating different AI providers
 */
export class AIServiceFactory implements IAIServiceFactory {
  private static instance: AIServiceFactory;
  private services: Map<string, IAIService> = new Map();

  private constructor() {}

  /**
   * Get singleton instance of the factory
   */
  static getInstance(): AIServiceFactory {
    if (!AIServiceFactory.instance) {
      AIServiceFactory.instance = new AIServiceFactory();
    }
    return AIServiceFactory.instance;
  }

  /**
   * Create a new AI service instance
   * @param provider - AI provider name (openai, gemini, langchain)
   * @param apiKey - API key for the provider
   * @param config - Optional configuration
   * @param serviceName - Optional service name for isolated learning
   */
  createService(provider: string, apiKey: string, config?: any, serviceName?: string): IAIService {
    console.log('🏭 [AIServiceFactory] Creating service:', { provider, serviceName });

    switch (provider.toLowerCase()) {
      case 'openai':
        return new OpenAIService(apiKey, config, serviceName);
      case 'gemini':
        return new GeminiService(apiKey, config, serviceName);
      case 'langchain':
        return new LangChainService(apiKey, config, serviceName);
      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
  }

  /**
   * Create and register a service with a custom name
   * The service name is used for isolated learning - each service maintains separate feedback history
   */
  createAndRegisterService(name: string, config: AIServiceConfig): IAIService {
    const service = this.createService(config.provider, config.apiKey, config.defaultConfig, name);
    this.registerService(name, service);
    console.log('📝 [AIServiceFactory] Service created and registered:', name);
    return service;
  }

  /**
   * Register a service instance with a custom name
   */
  registerService(name: string, service: IAIService): void {
    this.services.set(name, service);
  }

  /**
   * Get a registered service by name
   */
  getService(name: string): IAIService | undefined {
    return this.services.get(name);
  }

  /**
   * Remove a registered service
   */
  removeService(name: string): boolean {
    return this.services.delete(name);
  }

  /**
   * List all registered service names
   */
  listServices(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get list of supported providers
   */
  getSupportedProviders(): string[] {
    return ['openai', 'gemini', 'langchain'];
  }

  /**
   * Create a service with fallback options
   * Tries multiple providers in order until one succeeds
   */
  async createServiceWithFallback(
    configs: AIServiceConfig[]
  ): Promise<{ service: IAIService; provider: string }> {
    const errors: Error[] = [];

    for (const config of configs) {
      try {
        const service = this.createService(config.provider, config.apiKey, config.defaultConfig);
        // Test the service with a simple request
        await service.generateResponse({
          prompt: 'Hello, can you respond with just "OK"?',
          userId: 'test-user'
        });

        return { service, provider: config.provider };
      } catch (error) {
        errors.push(error as Error);
        console.warn(`Failed to initialize ${config.provider} service:`, error);
      }
    }

    throw new Error(
      `All AI service providers failed. Errors: ${errors.map(e => e.message).join(', ')}`
    );
  }

  /**
   * Get recommended service based on use case
   */
  getRecommendedService(useCase: 'general' | 'raw-materials' | 'analytics'): string {
    switch (useCase) {
      case 'general':
        return 'openai'; // Good all-around performance
      case 'raw-materials':
        return 'gemini'; // Better for technical content
      case 'analytics':
        return 'langchain'; // Advanced chain capabilities
      default:
        return 'openai';
    }
  }

  /**
   * Clear all registered services
   */
  clearServices(): void {
    this.services.clear();
  }

  /**
   * Get service health status
   */
  async checkServiceHealth(name: string): Promise<{
    status: 'healthy' | 'unhealthy' | 'not_found';
    latency?: number;
    error?: string;
  }> {
    const service = this.getService(name);
    if (!service) {
      return { status: 'not_found' };
    }

    try {
      const startTime = Date.now();
      await service.generateResponse({
        prompt: 'Health check',
        userId: 'health-check'
      });
      const latency = Date.now() - startTime;
      return { status: 'healthy', latency };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get health status for all registered services
   */
  async checkAllServicesHealth(): Promise<Record<string, {
    status: 'healthy' | 'unhealthy' | 'not_found';
    latency?: number;
    error?: string;
  }>> {
    const results: Record<string, any> = {};

    for (const name of this.listServices()) {
      results[name] = await this.checkServiceHealth(name);
    }

    return results;
  }
}

/**
 * Convenience function to get the factory instance
 */
export function getAIServiceFactory(): AIServiceFactory {
  return AIServiceFactory.getInstance();
}