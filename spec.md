# EMOVA AI — Premium AI Assistant Specification

## 1. Project Overview

Build EMOVA AI, a premium multi-model AI assistant inspired by the capabilities of ChatGPT, Google Gemini, Claude and Grok.

The application must support real AI conversations, multiple AI providers, image generation, file attachments, document analysis, web research, voice interaction, conversation history and personalisation.

The application must use real API integrations. Mock responses must never be presented as genuine AI responses.

## 2. Existing Project Preservation

Before making changes:

- Inspect the entire existing repository.
- Understand the current frontend and backend architecture.
- Inspect existing authentication and Supabase integration.
- Inspect the OpenRouter integration.
- Inspect the image-generation service and Replicate integration.
- Inspect existing database migrations and tests.
- Identify existing bugs and incomplete features.
- Preserve working functionality.
- Do not recreate the project unnecessarily.
- Do not delete existing files without justification.
- Do not expose API keys in frontend code.

## 3. AI Chat System

Implement:

- Real-time AI conversations.
- Streaming responses where supported.
- Conversation history.
- New conversation creation.
- Conversation search.
- Rename, archive and delete conversations.
- Copy responses.
- Regenerate responses.
- Edit user messages.
- Stop response generation.
- Markdown rendering.
- Code syntax highlighting.
- Code copy buttons.
- Clear error messages.
- Loading indicators.
- Retry failed requests.

## 4. Multiple AI Providers

Support:

- OpenAI GPT.
- Google Gemini.
- Anthropic Claude.
- xAI Grok.

Requirements:

- Create a provider abstraction layer.
- Support provider-specific model identifiers.
- Allow users to select available models.
- Display the active model.
- Support provider-specific API credentials through secure environment variables.
- Use OpenRouter as an optional unified provider.
- Validate provider configuration.
- Handle rate limits, unavailable models, timeouts and API errors.
- Never silently replace one model with another.
- Never return fabricated responses when a provider fails.

Each provider must be independently tested using real API requests before being marked operational.

## 5. Image Generation

Implement genuine AI image generation using Replicate.

Requirements:

- Text-to-image generation.
- Prompt input.
- Image dimensions and aspect ratios.
- Supported image styles.
- Generation progress indicators.
- Generated image preview.
- Download generated image.
- Regenerate image.
- Image history.
- Save generated image records to Supabase.
- User-specific image history.
- Proper provider error handling.
- Poll asynchronous image-generation jobs until completion.

Do not return placeholder SVGs or fake generated images as successful results.

## 6. File Attachments

Support uploading:

- PDF
- DOC
- DOCX
- TXT
- CSV
- XLS
- XLSX
- PPT
- PPTX
- PNG
- JPG
- JPEG
- WEBP

Requirements:

- Attachment button beside the message input.
- Drag-and-drop uploads.
- Multiple file uploads.
- File previews.
- File removal before sending.
- File size validation.
- File type validation.
- Upload progress.
- Secure file storage.
- User-specific file access.
- File processing status.
- Clear upload errors.

## 7. Document Analysis

Users must be able to:

- Ask questions about uploaded documents.
- Summarise documents.
- Extract important information.
- Explain difficult sections.
- Compare multiple documents.
- Extract tables.
- Analyse spreadsheets.
- Generate insights from CSV and Excel files.
- Reference uploaded documents in conversations.

Use suitable document parsers and extraction services. Do not send unsupported raw binary files directly to text-only AI models.

## 8. Web Search and Research

Implement:

- Search the web for current information.
- Display source links.
- Provide citations.
- Summarise search results.
- Research mode.
- Distinguish sourced information from AI-generated explanations.
- Handle search-provider errors.

## 9. Voice Features

Implement:

- Speech-to-text input.
- Text-to-speech responses.
- Microphone permission handling.
- Play and pause audio.
- Stop speech playback.
- Voice interaction mode where supported.

## 10. Memory and Personalisation

Implement:

- User-controlled memory.
- Custom instructions.
- Remember useful preferences.
- Review and manage stored information.
- Delete individual memory entries.
- Project-specific context.
- Respect user privacy and permissions.

## 11. Projects and Workspaces

Implement:

- Create projects.
- Rename projects.
- Delete projects.
- Add project instructions.
- Attach project files.
- Maintain project-specific conversations.
- Search project conversations.

## 12. User Interface

Create a polished, responsive interface with:

- Sidebar navigation.
- New chat button.
- Conversation history.
- Model selector.
- Attachment button.
- Image-generation interface.
- Voice controls.
- Search controls.
- User profile and settings.
- Light and dark themes.
- Responsive mobile layout.
- Accessible controls.
- Clear loading, empty and error states.

Maintain EMOVA AI's existing branding where possible.

## 13. Security

- Keep provider API keys on the backend.
- Use authentication middleware.
- Validate uploaded files.
- Enforce upload size limits.
- Protect file access.
- Apply Supabase Row Level Security.
- Validate user ownership of conversations and files.
- Apply rate limits.
- Sanitize user input.
- Avoid exposing service-role credentials.
- Never log secrets or full API keys.

## 14. Testing and Verification

Create tests for:

- Authentication.
- Chat requests.
- Every configured AI provider.
- Model selection.
- Streaming responses.
- Image generation.
- Image-generation polling.
- File uploads.
- Document parsing.
- Document analysis.
- Web search.
- Conversation history.
- User permissions.
- Error handling.

Distinguish mocked tests from real integration tests.

A feature is not complete merely because mocked tests pass.

## 15. Implementation Rules

- Inspect before editing.
- Implement incrementally.
- Preserve working functionality.
- Avoid unnecessary dependencies.
- Keep code modular and maintainable.
- Update database migrations when necessary.
- Update `.env.example` with placeholder names only.
- Never write real credentials into source files.
- Do not deploy or push to GitHub without explicit permission.

## 16. Definition of Done

EMOVA AI is ready only when:

1. Real AI chat works.
2. GPT, Gemini, Claude and Grok work when configured.
3. Image generation returns genuine generated images.
4. Attachments upload successfully.
5. Supported documents can be analysed.
6. Conversation history persists.
7. User permissions are enforced.
8. Errors are handled honestly.
9. The application works on desktop and mobile.
10. Real integration tests verify the critical workflows.
