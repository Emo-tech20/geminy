-- Nova AI Database Setup for Supabase
-- Run this SQL in your Supabase SQL editor to set up the database schema

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Create conversations table
create table if not exists conversations (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Create messages table
create table if not exists messages (
  id uuid default uuid_generate_v4() primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Create indexes for better query performance
create index if not exists conversations_user_id_idx on conversations(user_id);
create index if not exists conversations_updated_at_idx on conversations(updated_at desc);
create index if not exists messages_conversation_id_idx on messages(conversation_id);
create index if not exists messages_user_id_idx on messages(user_id);
create index if not exists messages_created_at_idx on messages(created_at);

-- Enable Row Level Security (RLS)
alter table conversations enable row level security;
alter table messages enable row level security;

-- Create RLS policies for conversations table
-- Users can only view their own conversations
create policy "Users can view their own conversations"
  on conversations for select
  using (auth.uid() = user_id);

-- Users can insert their own conversations
create policy "Users can create conversations"
  on conversations for insert
  with check (auth.uid() = user_id);

-- Users can update their own conversations
create policy "Users can update their own conversations"
  on conversations for update
  using (auth.uid() = user_id);

-- Users can delete their own conversations
create policy "Users can delete their own conversations"
  on conversations for delete
  using (auth.uid() = user_id);

-- Create RLS policies for messages table
-- Users can only view messages in their own conversations
create policy "Users can view messages in their conversations"
  on messages for select
  using (
    auth.uid() = user_id
    and conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  );

-- Users can insert messages into their own conversations
create policy "Users can insert messages in their conversations"
  on messages for insert
  with check (
    auth.uid() = user_id
    and conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  );

-- Users can delete their own messages
create policy "Users can delete their own messages"
  on messages for delete
  using (auth.uid() = user_id);

-- Create a function to update the updated_at timestamp
create or replace function update_conversations_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

-- Create a trigger to call the function
create trigger conversations_update_timestamp before update on conversations
  for each row
  execute function update_conversations_updated_at();
