// Import Gemini service as the primary AI provider
import { sendMessage as sendGeminiMessage, isGeminiConfigured } from './geminiService.js';

/**
 * Main entry point for sending messages to AI
 * Uses Google Gemini API as the primary provider
 * 
 * @param {Array} conversationHistory - Previous messages in the conversation
 * @param {string} userMessage - The user's message to send
 * @returns {Promise<Object>} Response with success flag and message or error
 */
export async function sendMessage(conversationHistory, userMessage) {
  // Use Gemini as the default AI provider
  return sendGeminiMessage(conversationHistory, userMessage);
}

/**
 * Check if AI service is configured
 * @returns {boolean} True if Gemini API key is set
 */
export function isAIConfigured() {
  return isGeminiConfigured();
}
