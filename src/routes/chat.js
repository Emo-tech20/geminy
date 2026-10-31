import express from 'express';
import { getOpenRouterModels, sendMessage } from '../services/aiService.js';
import { 
  createConversation, 
  addMessage, 
  getConversations, 
  getMessages,
  updateConversationTitle,
  deleteConversation 
} from '../services/dbService.js';

const router = express.Router();

const chatErrorStatus = {
  model_required: 400,
  unsupported_model: 400,
  invalid_message: 400,
  missing_credentials: 503,
  catalog_unavailable: 503,
  rate_limited: 429,
  timeout: 504,
  cancelled: 499,
  provider_authentication: 502,
  provider_payment_required: 502,
  model_unavailable: 502,
  provider_unavailable: 503,
  provider_error: 502,
  empty_response: 502
};

router.get('/models', async (req, res) => {
  const result = await getOpenRouterModels();
  if (!result.success) {
    return res.status(result.code === 'missing_credentials' ? 503 : 502).json({
      success: false,
      code: result.code,
      error: result.error
    });
  }
  res.json({
    success: true,
    models: result.models,
    defaultModel: result.defaultModel,
    catalogStale: result.catalogStale,
    warning: result.warning || null
  });
});

// Get all conversations for the user
router.get('/conversations', async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;

    if (!supabase) {
      return res.status(503).json({ error: 'Database service not configured' });
    }

    const conversations = await getConversations(supabase, userId);
    res.json({ conversations });
  } catch (error) {
    console.error('Get conversations error:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get messages for a conversation
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;

    if (!supabase) {
      return res.status(503).json({ error: 'Database service not configured' });
    }

    // Verify conversation ownership
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, user_id')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation || conversation.user_id !== userId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = await getMessages(supabase, conversationId);
    res.json({ messages });
  } catch (error) {
    console.error('Get messages error:', error.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send a message and get AI response
router.post('/conversations/:conversationId/messages', async (req, res) => {
  const controller = new AbortController();
  const abortOnDisconnect = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };
  req.once('aborted', abortOnDisconnect);
  res.once('close', abortOnDisconnect);

  try {
    const { conversationId } = req.params;
    const { message, model } = req.body || {};
    const userId = req.user.id;
    const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;

    if (!supabase) {
      console.error('[Chat] Supabase not configured');
      return res.status(503).json({ error: 'Database service not configured' });
    }

    // Validate message
    if (!message || typeof message !== 'string') {
      console.error('[Chat] Invalid message type:', typeof message);
      return res.status(400).json({ error: 'Message is required' });
    }

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      console.error('[Chat] Empty message after trim');
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    if (trimmedMessage.length > 5000) {
      console.error('[Chat] Message too long:', trimmedMessage.length);
      return res.status(400).json({ error: 'Message is too long (max 5000 characters)' });
    }

    console.log('[Chat] Processing message for conversation:', conversationId);

    // Verify conversation ownership
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, user_id')
      .eq('id', conversationId)
      .single();

    if (convError) {
      console.error('[Chat] Database error fetching conversation:', convError.message, convError.code);
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (!conversation || conversation.user_id !== userId) {
      console.error('[Chat] Conversation not found or unauthorized for user:', userId);
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Get conversation history for context
    let messages;
    try {
      messages = await getMessages(supabase, conversationId);
      console.log('[Chat] Loaded', messages.length, 'messages from history');
    } catch (historyError) {
      console.error('[Chat] Error loading message history:', historyError.message);
      return res.status(500).json({ error: 'Failed to load conversation history' });
    }

    console.log('[Chat] Calling AI service with', messages.length, 'messages in history');

    const aiResponse = await sendMessage(messages, trimmedMessage, {
      model,
      signal: controller.signal
    });

    if (!aiResponse) {
      console.error('[Chat] AI service returned null response');
      return res.status(500).json({ error: 'AI service returned invalid response' });
    }

    if (!aiResponse.success) {
      console.error('[Chat] AI service returned error:', aiResponse.error);
      if (res.destroyed || controller.signal.aborted) {
        return;
      }
      return res.status(chatErrorStatus[aiResponse.code] || 502).json({
        success: false,
        code: aiResponse.code || 'provider_error',
        error: aiResponse.error || 'The AI provider could not complete your request.'
      });
    }

    if (!aiResponse.message) {
      console.error('[Chat] AI service returned success but no message');
      return res.status(500).json({ error: 'AI service returned no response text' });
    }

    if (controller.signal.aborted || res.destroyed) {
      return;
    }

    const { data: savedUserMessage, error: msgError } = await addMessage(
      supabase,
      conversationId,
      userId,
      'user',
      trimmedMessage
    );

    if (msgError || !savedUserMessage) {
      console.error('[Chat] Failed to save user message:', msgError?.message);
      return res.status(500).json({
        success: false,
        code: 'message_persistence_failed',
        error: 'The AI responded, but your message could not be saved. It was not added to conversation history.'
      });
    }

    let aiMsgError;
    try {
      ({ error: aiMsgError } = await addMessage(
        supabase,
        conversationId,
        userId,
        'assistant',
        aiResponse.message
      ));
    } catch (error) {
      aiMsgError = error;
    }

    if (aiMsgError) {
      console.error('[Chat] Failed to save AI response:', aiMsgError.message, 'code:', aiMsgError.code);
      let rollbackError;
      try {
        ({ error: rollbackError } = await supabase
          .from('messages')
          .delete()
          .eq('id', savedUserMessage.id)
          .eq('user_id', userId));
      } catch (error) {
        rollbackError = error;
      }
      if (rollbackError) {
        console.error('[Chat] Failed to roll back unmatched user message:', rollbackError.message);
      }
      return res.status(500).json({
        success: false,
        code: 'message_persistence_failed',
        error: rollbackError
          ? 'The AI responded, but conversation history could not be saved consistently.'
          : 'The AI responded, but the reply could not be saved. The unsent message was removed from conversation history.'
      });
    }

    console.log('[Chat] Processing complete, sending response');

    // Update conversation title if first message
    if (messages.length === 0) {
      const title = trimmedMessage.substring(0, 50) + (trimmedMessage.length > 50 ? '...' : '');
      try {
        await updateConversationTitle(supabase, conversationId, title);
        console.log('[Chat] Updated conversation title');
      } catch (titleError) {
        console.error('[Chat] Failed to update title:', titleError.message);
        // Non-critical, continue
      }
    }

    res.json({
      success: true,
      userMessage: trimmedMessage,
      assistantMessage: aiResponse.message,
      model: aiResponse.model,
      requestedModel: aiResponse.requestedModel,
      modelName: aiResponse.modelName
    });
  } catch (error) {
    console.error('[Chat] UNEXPECTED ERROR in send message handler:', error.message);
    if (!res.destroyed && !controller.signal.aborted) {
      res.status(500).json({
        success: false,
        code: 'chat_error',
        error: 'Failed to process your message. Please try again.'
      });
    }
  } finally {
    req.off('aborted', abortOnDisconnect);
    res.off('close', abortOnDisconnect);
  }
});

// Create a new conversation
router.post('/conversations', async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;

    if (!supabase) {
      return res.status(503).json({ error: 'Database service not configured' });
    }

    const conversation = await createConversation(supabase, userId, 'New Chat');
    res.status(201).json({ conversation });
  } catch (error) {
    console.error('Create conversation error:', error.message);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Update conversation title
router.put('/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { title } = req.body;
    const userId = req.user.id;
    const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;

    if (!supabase) {
      return res.status(503).json({ error: 'Database service not configured' });
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (title.length > 200) {
      return res.status(400).json({ error: 'Title is too long (max 200 characters)' });
    }

    // Verify ownership
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('user_id')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation || conversation.user_id !== userId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    await updateConversationTitle(supabase, conversationId, title.trim());
    res.json({ message: 'Conversation title updated' });
  } catch (error) {
    console.error('Update conversation error:', error.message);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

// Delete conversation
router.delete('/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;

    if (!supabase) {
      return res.status(503).json({ error: 'Database service not configured' });
    }

    // Verify ownership
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('user_id')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation || conversation.user_id !== userId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Delete messages first (cascade delete)
    await supabase
      .from('messages')
      .delete()
      .eq('conversation_id', conversationId);

    // Delete conversation
    await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    res.json({ message: 'Conversation deleted' });
  } catch (error) {
    console.error('Delete conversation error:', error.message);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

export default router;
