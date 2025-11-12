'use client';

import { useState, useCallback, useEffect } from 'react';
import { IAIService } from '../services/core/ai-service-interface';
import { getAIServiceFactory } from '../services/core/ai-service-factory';
import { AIServiceConfig } from '../types/ai-types';

export interface UseAIServiceOptions {
  defaultProvider?: string;
  apiKey?: string;
  config?: Partial<AIServiceConfig['defaultConfig']>;
  autoRegister?: boolean;
  serviceName?: string;
  onServiceChange?: (service: IAIService | null) => void;
  onError?: (error: Error) => void;
}

export interface UseAIServiceReturn {
  service: IAIService | null;
  isLoading: boolean;
  error: Error | null;
  isHealthy: boolean;
  createService: (provider: string, apiKey: string, config?: any) => Promise<IAIService>;
  switchService: (serviceName: string) => boolean;
  registerService: (name: string, config: AIServiceConfig) => Promise<IAIService>;
  checkHealth: () => Promise<void>;
  getSupportedProviders: () => string[];
  availableServices: string[];
  clearError: () => void;
}

/**
 * Hook for managing AI service instances
 * Provides service creation, switching, and health monitoring capabilities
 */
export function useAIService(options: UseAIServiceOptions = {}): UseAIServiceReturn {
  const {
    defaultProvider = 'openai',
    apiKey,
    config,
    autoRegister = false,
    serviceName,
    onServiceChange,
    onError
  } = options;

  const [service, setService] = useState<IAIService | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isHealthy, setIsHealthy] = useState(true);
  const [availableServices, setAvailableServices] = useState<string[]>([]);

  const factory = getAIServiceFactory();

  // Update available services list
  useEffect(() => {
    setAvailableServices(factory.listServices());
  }, [factory]);

  // Initialize default service if API key is provided
  useEffect(() => {
    if (apiKey && defaultProvider && !service) {
      createService(defaultProvider, apiKey, config).catch(err => {
        console.error('Failed to initialize default service:', err);
      });
    }

    // Try to get registered service by name
    if (serviceName && !service) {
      const registeredService = factory.getService(serviceName);
      if (registeredService) {
        setService(registeredService);
        onServiceChange?.(registeredService);
      }
    }
  }, [apiKey, defaultProvider, serviceName, service, config, onServiceChange]);

  const createService = useCallback(async (
    provider: string,
    serviceApiKey: string,
    serviceConfig?: any
  ): Promise<IAIService> => {
    setIsLoading(true);
    setError(null);

    try {
      const newService = factory.createService(provider, serviceApiKey, serviceConfig);

      // Test the service
      await newService.generateResponse({
        prompt: 'Service initialization test',
        userId: 'init-test'
      });

      setService(newService);
      setIsHealthy(true);
      onServiceChange?.(newService);

      return newService;
    } catch (err) {
      const error = err as Error;
      setError(error);
      setIsHealthy(false);
      onError?.(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [factory, onServiceChange, onError]);

  const switchService = useCallback((serviceName: string): boolean => {
    const targetService = factory.getService(serviceName);
    if (targetService) {
      setService(targetService);
      onServiceChange?.(targetService);
      return true;
    }
    return false;
  }, [factory, onServiceChange]);

  const registerService = useCallback(async (
    name: string,
    serviceConfig: AIServiceConfig
  ): Promise<IAIService> => {
    setIsLoading(true);
    setError(null);

    try {
      const newService = factory.createAndRegisterService(name, serviceConfig);

      // Test the service
      await newService.generateResponse({
        prompt: 'Service registration test',
        userId: 'register-test'
      });

      setAvailableServices(factory.listServices());
      return newService;
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [factory, onError]);

  const checkHealth = useCallback(async () => {
    if (!service) return;

    try {
      const startTime = Date.now();
      await service.generateResponse({
        prompt: 'Health check',
        userId: 'health-check'
      });
      const latency = Date.now() - startTime;

      setIsHealthy(true);
      console.log(`AI Service health check passed. Latency: ${latency}ms`);
    } catch (err) {
      setIsHealthy(false);
      setError(err as Error);
      onError?.(err as Error);
    }
  }, [service, onError]);

  const getSupportedProviders = useCallback(() => {
    return factory.getSupportedProviders();
  }, [factory]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Periodic health check
  useEffect(() => {
    if (!service) return;

    const interval = setInterval(() => {
      checkHealth();
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [service, checkHealth]);

  return {
    service,
    isLoading,
    error,
    isHealthy,
    createService,
    switchService,
    registerService,
    checkHealth,
    getSupportedProviders,
    availableServices,
    clearError
  };
}