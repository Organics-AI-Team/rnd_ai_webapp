/**
 * Prompt Management System
 * Provides utilities for managing, templating, and optimizing prompts
 */

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
  variables: string[];
  category: 'system' | 'user' | 'rag' | 'feedback';
  version: string;
  examples?: PromptExample[];
}

export interface PromptExample {
  input: Record<string, any>;
  output: string;
  description?: string;
}

export interface PromptOptimization {
  originalPrompt: string;
  optimizedPrompt: string;
  improvements: string[];
  metrics: {
    clarity?: number;
    specificity?: number;
    effectiveness?: number;
  };
}

/**
 * Manages prompt templates, optimization, and dynamic prompt generation
 */
export class PromptManager {
  private templates: Map<string, PromptTemplate> = new Map();
  private optimizationHistory: Map<string, PromptOptimization[]> = new Map();

  constructor() {
    this.initializeDefaultTemplates();
  }

  /**
   * Initialize default prompt templates
   */
  private initializeDefaultTemplates(): void {
    const defaultTemplates: PromptTemplate[] = [
      {
        id: 'rag-enhanced-query',
        name: 'RAG Enhanced Query Template',
        description: 'Template for enhancing user queries with RAG results',
        template: `Original Query: {{query}}

{{#if ragResults}}
Context from Knowledge Base:
{{ragResults}}

Please provide a comprehensive response based on the above context and your expertise. When referencing the provided information, clearly indicate the source.
{{else}}
Please provide a helpful response to the query.
{{/if}}

{{#if userPreferences}}
User Preferences:
- Preferred Length: {{userPreferences.preferredLength}}
- Style: {{userPreferences.preferredStyle}}
- Complexity: {{userPreferences.preferredComplexity}}
{{/if}}`,
        variables: ['query', 'ragResults', 'userPreferences'],
        category: 'rag',
        version: '1.0.0'
      },

      {
        id: 'feedback-analysis',
        name: 'Feedback Analysis Template',
        description: 'Template for analyzing user feedback on AI responses',
        template: `Analyze the following user feedback and provide insights:

Response: {{response}}
User Feedback:
- Type: {{feedback.type}}
- Score: {{feedback.score}}/5
- Comment: {{feedback.comment}}
- Timestamp: {{feedback.timestamp}}

Please provide:
1. Key themes in the feedback
2. Actionable improvements for future responses
3. Sentiment analysis
4. Recommendations for response optimization`,
        variables: ['response', 'feedback'],
        category: 'feedback',
        version: '1.0.0'
      },

      {
        id: 'conversation-summary',
        name: 'Conversation Summary Template',
        description: 'Template for summarizing conversation history',
        template: `Summarize the following conversation:

Conversation History:
{{conversationHistory}}

Summary should include:
1. Main topics discussed
2. Key decisions made
3. Action items or next steps
4. Important details to remember

Keep the summary concise but comprehensive, approximately {{targetLength}} words.`,
        variables: ['conversationHistory', 'targetLength'],
        category: 'user',
        version: '1.0.0'
      },

      {
        id: 'agent-handoff',
        name: 'Agent Handoff Template',
        description: 'Template for handing off conversations between specialized agents',
        template: `Agent Handoff Request:

Current Agent: {{currentAgent}}
Target Agent: {{targetAgent}}
User ID: {{userId}}
Context: {{context}}
Conversation Summary: {{summary}}

Specific Instructions for {{targetAgent}}:
{{instructions}}

Please take over this conversation and assist the user with their needs in your area of expertise.`,
        variables: ['currentAgent', 'targetAgent', 'userId', 'context', 'summary', 'instructions'],
        category: 'system',
        version: '1.0.0'
      }
    ];

    defaultTemplates.forEach(template => {
      this.templates.set(template.id, template);
    });
  }

  /**
   * Register a new prompt template
   */
  registerTemplate(template: PromptTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Get prompt template by ID
   */
  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Get all templates by category
   */
  getTemplatesByCategory(category: string): PromptTemplate[] {
    return Array.from(this.templates.values()).filter(template => template.category === category);
  }

  /**
   * Render a template with provided variables
   */
  renderTemplate(templateId: string, variables: Record<string, any>): string {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    let rendered = template.template;

    // Simple variable substitution (you might want to use a more sophisticated templating engine)
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      rendered = rendered.replace(regex, String(value || ''));
    });

    // Handle basic conditional logic (simplified)
    rendered = this.processConditionals(rendered, variables);

    return rendered;
  }

  /**
   * Process simple conditional logic in templates
   */
  private processConditionals(template: string, variables: Record<string, any>): string {
    // Simple {{#if variable}}...{{/if}} processing
    const ifRegex = /{{#if\s+(\w+)}}([\s\S]*?){{\/if}}/g;
    return template.replace(ifRegex, (match, variable, content) => {
      return variables[variable] ? content : '';
    });
  }

  /**
   * Create a dynamic prompt that combines multiple templates
   */
  createDynamicPrompt(config: {
    systemPrompt?: string;
    userPrompt?: string;
    ragResults?: string;
    conversationHistory?: string;
    userPreferences?: any;
    customInstructions?: string;
  }): string {
    const parts: string[] = [];

    if (config.systemPrompt) {
      parts.push(`System: ${config.systemPrompt}`);
    }

    if (config.conversationHistory) {
      parts.push(`Conversation History:\n${config.conversationHistory}`);
    }

    if (config.ragResults) {
      parts.push(`Context:\n${config.ragResults}`);
    }

    if (config.userPreferences) {
      const prefs = [];
      if (config.userPreferences.preferredLength) {
        prefs.push(`Length: ${config.userPreferences.preferredLength}`);
      }
      if (config.userPreferences.preferredStyle) {
        prefs.push(`Style: ${config.userPreferences.preferredStyle}`);
      }
      if (config.userPreferences.preferredComplexity) {
        prefs.push(`Complexity: ${config.userPreferences.preferredComplexity}`);
      }
      if (prefs.length > 0) {
        parts.push(`User Preferences: ${prefs.join(', ')}`);
      }
    }

    if (config.customInstructions) {
      parts.push(`Additional Instructions: ${config.customInstructions}`);
    }

    if (config.userPrompt) {
      parts.push(`User: ${config.userPrompt}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Optimize a prompt based on performance metrics
   */
  async optimizePrompt(
    promptId: string,
    metrics: {
      averageResponseTime?: number;
      userSatisfaction?: number;
      taskCompletionRate?: number;
      clarity?: number;
    }
  ): Promise<PromptOptimization> {
    const template = this.templates.get(promptId);
    if (!template) {
      throw new Error(`Template not found: ${promptId}`);
    }

    const originalPrompt = template.template;
    let optimizedPrompt = originalPrompt;
    const improvements: string[] = [];

    // Optimization strategies based on metrics
    if (metrics.averageResponseTime && metrics.averageResponseTime > 5000) {
      // Response time is too high, make prompt more concise
      optimizedPrompt = this.makePromptMoreConcise(optimizedPrompt);
      improvements.push('Made prompt more concise to reduce response time');
    }

    if (metrics.userSatisfaction && metrics.userSatisfaction < 3.5) {
      // Low satisfaction, add more specific instructions
      optimizedPrompt = this.addSpecificity(optimizedPrompt);
      improvements.push('Added more specific instructions for better clarity');
    }

    if (metrics.clarity && metrics.clarity < 0.7) {
      // Low clarity, improve structure and formatting
      optimizedPrompt = this.improvePromptStructure(optimizedPrompt);
      improvements.push('Improved prompt structure and formatting');
    }

    const optimization: PromptOptimization = {
      originalPrompt,
      optimizedPrompt,
      improvements,
      metrics: {
        clarity: metrics.clarity || 0,
        specificity: this.calculateSpecificity(optimizedPrompt),
        effectiveness: metrics.userSatisfaction || 0
      }
    };

    // Store optimization history
    if (!this.optimizationHistory.has(promptId)) {
      this.optimizationHistory.set(promptId, []);
    }
    this.optimizationHistory.get(promptId)!.push(optimization);

    return optimization;
  }

  /**
   * Make a prompt more concise
   */
  private makePromptMoreConcise(prompt: string): string {
    // Remove redundant phrases and be more direct
    return prompt
      .replace(/Please be sure to/g, '')
      .replace(/It is important that/g, '')
      .replace(/Make sure to/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Add more specificity to a prompt
   */
  private addSpecificity(prompt: string): string {
    // Add more specific instructions
    return prompt + '\n\nPlease provide specific, actionable advice with clear examples when possible.';
  }

  /**
   * Improve prompt structure and formatting
   */
  private improvePromptStructure(prompt: string): string {
    // Add better formatting with clear sections
    if (!prompt.includes('\n\n')) {
      return prompt.replace(/([.!?])\s+/g, '$1\n\n');
    }
    return prompt;
  }

  /**
   * Calculate specificity score of a prompt
   */
  private calculateSpecificity(prompt: string): number {
    // Simple heuristic: count specific instructions and contextual information
    const specificWords = ['specifically', 'exactly', 'precisely', 'clearly', 'detail', 'example', 'step'];
    const specificCount = specificWords.reduce((count, word) =>
      count + (prompt.toLowerCase().match(new RegExp(word, 'g')) || []).length, 0);

    return Math.min(1, specificCount / 10);
  }

  /**
   * Get optimization history for a template
   */
  getOptimizationHistory(templateId: string): PromptOptimization[] {
    return this.optimizationHistory.get(templateId) || [];
  }

  /**
   * Validate a prompt template
   */
  validateTemplate(template: PromptTemplate): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!template.id || template.id.trim() === '') {
      errors.push('Template ID is required');
    }

    if (!template.name || template.name.trim() === '') {
      errors.push('Template name is required');
    }

    if (!template.template || template.template.trim() === '') {
      errors.push('Template content is required');
    }

    // Check for undefined variables in template
    template.variables.forEach(variable => {
      const regex = new RegExp(`{{${variable}}}`, 'g');
      if (!template.template.match(regex)) {
        errors.push(`Variable '${variable}' not found in template`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Search templates by name or description
   */
  searchTemplates(query: string): PromptTemplate[] {
    const searchTerms = query.toLowerCase().split(' ');
    return Array.from(this.templates.values()).filter(template =>
      searchTerms.every(term =>
        template.name.toLowerCase().includes(term) ||
        template.description.toLowerCase().includes(term)
      )
    );
  }

  /**
   * Export all templates as JSON
   */
  exportTemplates(): Record<string, PromptTemplate> {
    const exported: Record<string, PromptTemplate> = {};
    this.templates.forEach((template, id) => {
      exported[id] = template;
    });
    return exported;
  }

  /**
   * Import templates from JSON
   */
  importTemplates(templates: Record<string, PromptTemplate>): void {
    Object.entries(templates).forEach(([id, template]) => {
      this.templates.set(id, template);
    });
  }
}