/**
 * Shared AI Chat Components
 *
 * Reusable components for AI chat interfaces across the application.
 * These components follow DRY principles and maintain consistent UX.
 * No hardcoded HTML - all component-based rendering.
 */

// Core atomic components
export { AIChatMessage, type Message } from './ai_chat_message';
export { AIChatInput } from './ai_chat_input';
export { AIFeaturesGrid, type Feature } from './ai_features_grid';
export { AILoadingIndicator } from './ai_loading_indicator';
export { AIFeedbackButtons } from './ai_feedback_buttons';
export { AIEmptyState } from './ai_empty_state';
export { AIAuthGuard } from './ai_auth_guard';

// Area composite components
export { AIChatMessagesArea } from './ai_chat_messages_area';
export { AIChatInputArea } from './ai_chat_input_area';

// Layout structural components - SEPARATED
export { AIPageHeader } from './ai_page_header';
export { AIChatHeader } from './ai_chat_header';
export { AIChatMessagesContainer } from './ai_chat_container';
export { AIChatInputContainer } from './ai_chat_container';
