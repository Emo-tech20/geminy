export async function createConversation(supabase, userId, title = 'New Chat') {
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      title
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create conversation: ${error.message}`);
  }

  return data;
}

export async function addMessage(supabase, conversationId, userId, role, content) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role,
      content
    })
    .select()
    .single();

  if (error) {
    return { error };
  }

  return { data };
}

export async function getConversations(supabase, userId) {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch conversations: ${error.message}`);
  }

  return data || [];
}

export async function getMessages(supabase, conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  return data || [];
}

export async function updateConversationTitle(supabase, conversationId, title) {
  const { data, error } = await supabase
    .from('conversations')
    .update({
      title,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversationId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update conversation: ${error.message}`);
  }

  return data;
}

export async function deleteConversation(supabase, conversationId, userId) {
  // Verify ownership
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('user_id')
    .eq('id', conversationId)
    .single();

  if (convError || !conversation || conversation.user_id !== userId) {
    throw new Error('Conversation not found');
  }

  // Delete messages
  const { error: msgError } = await supabase
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId);

  if (msgError) {
    throw new Error(`Failed to delete messages: ${msgError.message}`);
  }

  // Delete conversation
  const { error: delError } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId);

  if (delError) {
    throw new Error(`Failed to delete conversation: ${delError.message}`);
  }

  return true;
}
