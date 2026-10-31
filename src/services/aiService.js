// Import OpenRouter service as the primary AI provider
import {
  getOpenRouterModels,
  sendMessage as sendOpenRouterMessage,
  isOpenRouterConfigured
} from './openrouterService.js';

/**
 * Main entry point for sending messages to AI
 * Uses OpenRouter API which provides access to multiple AI models
 * 
 * @param {Array} conversationHistory - Previous messages in the conversation
 * @param {string} userMessage - The user's message to send
 * @returns {Promise<Object>} Response with success flag and message or error
 */
export async function sendMessage(conversationHistory, userMessage, options = {}) {
  return sendOpenRouterMessage(conversationHistory, userMessage, options);
}

export { getOpenRouterModels };

/**
 * Check if AI service is configured
 * @returns {boolean} True if OpenRouter API key is set
 */
export function isAIConfigured() {
  return isOpenRouterConfigured();
}
