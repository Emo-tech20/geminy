import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_MODEL = 'gemini-1.5-flash'; // Currently supported Gemini model
const REQUEST_TIMEOUT = 30000; // 30 seconds
const MAX_HISTORY_MESSAGES = 20; // Limit context window

let genAI = null;
let model = null;
let GEMINI_API_KEY = null;

// Initialize the Gemini client
function initializeGemini() {
  // Load API key on first use (ensures dotenv.config() has been called)
  if (!GEMINI_API_KEY) {
    GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  }

  if (genAI) {
    return;
  }

  if (!GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY not configured');
    return;
  }

  try {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  } catch (error) {
    console.error('Failed to initialize Gemini:', error.message);
  }
}

// Convert conversation history to Gemini format
function formatConversationForGemini(conversationHistory) {
  // Gemini uses "parts" format with "text" content
  const messages = conversationHistory.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }]
  }));

  // Limit to last 20 messages to manage token usage
  const limitedMessages = messages.slice(-MAX_HISTORY_MESSAGES);

  // Ensure history doesn't end with a user message (Gemini requirement)
  // If it does, remove the last message since we'll be adding a new user message
  if (limitedMessages.length > 0 && limitedMessages[limitedMessages.length - 1].role === 'user') {
    limitedMessages.pop();
  }

  return limitedMessages;
}

export async function sendMessage(conversationHistory, userMessage) {
  try {
    // Load API key at runtime (ensures dotenv.config() has been called)
    if (!GEMINI_API_KEY) {
      GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    }

    // Check if API key is configured
    if (!GEMINI_API_KEY) {
      return {
        success: false,
        error: 'Gemini API not configured. Please set GEMINI_API_KEY in environment variables.'
      };
    }

    // For development: if key is invalid but we're in development, provide a demo response
    if (process.env.NODE_ENV === 'development' && !GEMINI_API_KEY.startsWith('AIza')) {
      console.warn('[Gemini] Running in development mode with demo response (invalid API key detected)');
      return {
        success: true,
        message: `Demo Response: I received your message "${userMessage.substring(0, 50)}${userMessage.length > 50 ? '...' : ''}". To enable real AI responses, set a valid Gemini API key from https://aistudio.google.com/app/apikey in your .env file.`,
        isDemoMode: true
      };
    }

    // Validate API key format (should start with AIza for standard keys)
    if (!GEMINI_API_KEY.startsWith('AIza')) {
      console.error('[Gemini] Invalid API key format. Key should start with "AIza"');
      return {
        success: false,
        error: 'Gemini API key appears to be invalid. Please check your configuration.'
      };
    }

    // Initialize Gemini if needed
    initializeGemini();

    if (!model) {
      return {
        success: false,
        error: 'Failed to initialize Gemini AI service.'
      };
    }

    // Validate input
    if (!userMessage || typeof userMessage !== 'string') {
      return {
        success: false,
        error: 'Invalid message format.'
      };
    }

    // Format conversation for Gemini (excludes the current message)
    const formattedHistory = formatConversationForGemini(conversationHistory);

    // Create chat session with history
    const chat = model.startChat({
      history: formattedHistory
    });

    // Send the user message and get response with timeout
    const response = await Promise.race([
      chat.sendMessage(userMessage),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), REQUEST_TIMEOUT)
      )
    ]);

    // Extract text from response
    const assistantMessage = response.response?.text?.();

    if (!assistantMessage) {
      console.error('Unexpected Gemini response format:', response);
      return {
        success: false,
        error: 'Received an unexpected response from the AI service.'
      };
    }

    return {
      success: true,
      message: assistantMessage
    };
  } catch (error) {
    console.error('Gemini service error:', error.message);

    // Handle specific error types
    if (error.message.includes('timeout') || error.name === 'AbortError') {
      return {
        success: false,
        error: 'The request took too long. Please try again.'
      };
    }

    if (error.message.includes('API key')) {
      return {
        success: false,
        error: 'Gemini API authentication failed. Please check your API key configuration.'
      };
    }

    if (error.message.includes('rate limit') || error.status === 429) {
      return {
        success: false,
        error: 'Too many requests. The AI service is busy. Please try again in a moment.'
      };
    }

    if (error.message.includes('blocked') || error.message.includes('safety')) {
      return {
        success: false,
        error: 'The message was blocked by safety filters. Please try a different query.'
      };
    }

    if (error.message.includes('fetch')) {
      return {
        success: false,
        error: 'Unable to connect to the AI service. Please check your internet connection.'
      };
    }

    return {
      success: false,
      error: 'An error occurred while processing your request. Please try again.'
    };
  }
}

// Export for health checks
export function isGeminiConfigured() {
  // Check at runtime to ensure dotenv has been loaded
  return !!process.env.GEMINI_API_KEY;
}

export function getGeminiModel() {
  return GEMINI_MODEL;
}
