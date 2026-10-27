import express from 'express';
import { sendMessage } from '../services/aiService.js';
import { 
  createConversation, 
  addMessage, 
  getConversations, 
  getMessages,
  updateConversationTitle,
  deleteConversation 
} from '../services/dbService.js';

const router = express.Router();

// Get all conversations for the user
router.get('/conversations', async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = req.app.locals.supabase;

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
    const supabase = req.app.locals.supabase;

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
  try {
    const { conversationId } = req.params;
    const { message } = req.body;
    const userId = req.user.id;
    const supabase = req.app.locals.supabase;

    if (!supabase) {
      return res.status(503).json({ error: 'Database service not configured' });
    }

    // Validate message
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    if (trimmedMessage.length > 5000) {
      return res.status(400).json({ error: 'Message is too long (max 5000 characters)' });
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

    // Save user message
    const { error: msgError } = await addMessage(
      supabase,
      conversationId,
      userId,
      'user',
      trimmedMessage
    );

    if (msgError) {
      return res.status(500).json({ error: 'Failed to save message' });
    }

    // Get conversation history for context
    const messages = await getMessages(supabase, conversationId);
    
    // Send to AI
    const aiResponse = await sendMessage(messages, trimmedMessage);

    if (!aiResponse.success) {
      return res.status(500).json({ 
        error: aiResponse.error || 'Failed to get AI response. Please try again later.' 
      });
    }

    // Save AI response
    const { error: aiMsgError } = await addMessage(
      supabase,
      conversationId,
      userId,
      'assistant',
      aiResponse.message
    );

    if (aiMsgError) {
      console.error('Failed to save AI response:', aiMsgError);
      // Still return the response to the user
    }

    // Update conversation title if first message
    if (messages.length === 1) {
      const title = trimmedMessage.substring(0, 50) + (trimmedMessage.length > 50 ? '...' : '');
      await updateConversationTitle(supabase, conversationId, title);
    }

    res.json({
      userMessage: trimmedMessage,
      assistantMessage: aiResponse.message
    });
  } catch (error) {
    console.error('Send message error:', error.message);
    res.status(500).json({ error: 'Failed to process message. Please try again later.' });
  }
});

// Create a new conversation
router.post('/conversations', async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = req.app.locals.supabase;

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
    const supabase = req.app.locals.supabase;

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
    const supabase = req.app.locals.supabase;

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
