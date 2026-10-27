class EMOVA {
    constructor() {
        this.currentPage = 'landing';
        this.currentUser = null;
        this.currentConversation = null;
        this.conversations = [];
        this.accessToken = null;
        this.refreshToken = null;
        this.apiBaseUrl = '/api';
        
        this.init();
    }

    async init() {
        this.setupTheme();
        this.attachEventListeners();
        await this.checkAuth();
    }

    setupTheme() {
        // First check localStorage, then check system preference
        let savedTheme = localStorage.getItem('theme');
        if (!savedTheme) {
            // Use system preference if no saved theme
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            savedTheme = prefersDark ? 'dark' : 'light';
        }
        this.setTheme(savedTheme);
        
        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) {
                // Only apply system preference if user hasn't set explicit preference
                this.setTheme(e.matches ? 'dark' : 'light');
            }
        });
    }

    setTheme(theme) {
        const html = document.documentElement;
        if (theme === 'light') {
            html.classList.add('light-theme');
        } else {
            html.classList.remove('light-theme');
        }
        localStorage.setItem('theme', theme);
    }

    toggleTheme() {
        const html = document.documentElement;
        const isLight = html.classList.contains('light-theme');
        this.setTheme(isLight ? 'dark' : 'light');
    }

    attachEventListeners() {
        // Auth forms
        const signupForm = document.getElementById('signup-form');
        if (signupForm) {
            signupForm.addEventListener('submit', (e) => this.handleSignUp(e));
        }

        const signinForm = document.getElementById('signin-form');
        if (signinForm) {
            signinForm.addEventListener('submit', (e) => this.handleSignIn(e));
        }

        const forgotPasswordForm = document.getElementById('forgot-password-form');
        if (forgotPasswordForm) {
            forgotPasswordForm.addEventListener('submit', (e) => this.handleForgotPassword(e));
        }

        // Password toggles
        document.addEventListener('click', (e) => {
            if (e.target.closest('.password-toggle')) {
                this.togglePasswordVisibility(e.target.closest('.password-toggle'));
            }
        });

        // Theme toggles
        document.addEventListener('click', (e) => {
            if (e.target.closest('.theme-toggle')) {
                this.toggleTheme();
                this.setupPasswordToggles();
            }
        });

        // Composer
        const composerForm = document.querySelector('.composer-form');
        if (composerForm) {
            composerForm.addEventListener('submit', (e) => this.sendMessage(e));
        }

        const composerInput = document.querySelector('.composer-input');
        if (composerInput) {
            composerInput.addEventListener('keydown', (e) => this.handleComposerKeydown(e));
        }

        // Sidebar
        const sidebarClose = document.querySelector('.sidebar-close');
        if (sidebarClose) {
            sidebarClose.addEventListener('click', () => this.toggleSidebar());
        }

        const sidebarToggle = document.querySelector('.sidebar-toggle');
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', () => this.toggleSidebar());
        }

        // Account menu
        const accountMenuToggle = document.querySelector('.account-menu-toggle');
        if (accountMenuToggle) {
            accountMenuToggle.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleAccountMenu();
            });
        }

        // Close account menu on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.sidebar-footer') && document.querySelector('.account-menu')?.style.display === 'flex') {
                document.querySelector('.account-menu').style.display = 'none';
            }
        });
    }

    setupPasswordToggles() {
        document.querySelectorAll('.password-toggle').forEach(btn => {
            btn.addEventListener('click', () => this.togglePasswordVisibility(btn));
        });
    }

    togglePasswordVisibility(button) {
        const targetId = button.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (input) {
            input.type = input.type === 'password' ? 'text' : 'password';
        }
    }

    showPage(pageName) {
        const app = document.getElementById('app');
        const template = document.getElementById(`${pageName}-template`);
        
        if (!template) {
            console.error(`Template ${pageName}-template not found`);
            return;
        }

        // Clear previous page
        app.innerHTML = '';

        // Clone and append new content
        const clone = template.content.cloneNode(true);
        app.appendChild(clone);

        // Update current page tracker
        this.currentPage = pageName;
        
        // Scroll to top
        window.scrollTo(0, 0);
        
        // Re-attach event listeners
        this.attachEventListeners();

        // Page-specific setup
        if (pageName === 'landing') {
            this.setupPasswordToggles();
        } else if (pageName === 'chat') {
            // Give page time to render before setup
            setTimeout(() => this.setupChatPage(), 0);
        } else if (pageName === 'signin' || pageName === 'signup') {
            this.setupPasswordToggles();
        }
    }

    showLanding() {
        this.showPage('landing');
    }

    showSignUp() {
        this.showPage('signup');
    }

    showSignIn() {
        this.showPage('signin');
    }

    showForgotPassword() {
        this.showPage('forgot-password');
    }

    showChat() {
        this.showPage('chat');
    }

    async checkAuth() {
        try {
            const accessToken = localStorage.getItem('accessToken');
            const refreshToken = localStorage.getItem('refreshToken');

            if (!accessToken) {
                this.showLanding();
                return;
            }

            this.accessToken = accessToken;
            this.refreshToken = refreshToken;

            // Verify token is still valid
            const response = await fetch(`${this.apiBaseUrl}/auth/user`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
                this.showChat();
            } else if (response.status === 401 && refreshToken) {
                // Try to refresh
                await this.refreshAccessToken();
            } else {
                this.clearAuth();
                this.showLanding();
            }
        } catch (error) {
            console.error('Auth check error:', error);
            this.showLanding();
        }
    }

    async refreshAccessToken() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: this.refreshToken })
            });

            if (response.ok) {
                const data = await response.json();
                this.accessToken = data.session.access_token;
                this.refreshToken = data.session.refresh_token;
                localStorage.setItem('accessToken', this.accessToken);
                localStorage.setItem('refreshToken', this.refreshToken);
                return true;
            } else {
                this.clearAuth();
                return false;
            }
        } catch (error) {
            console.error('Token refresh error:', error);
            return false;
        }
    }

    async handleSignUp(e) {
        e.preventDefault();
        const form = e.target;
        const fullName = form.elements.fullName?.value?.trim();
        const email = form.elements.email?.value?.trim();
        const password = form.elements.password?.value;
        const confirmPassword = form.elements.confirmPassword?.value;
        const terms = form.elements.terms?.checked;

        // Clear previous errors
        this.clearFormErrors(form);

        // Validation
        let isValid = true;

        if (!fullName) {
            this.showFieldError(form.elements.fullName, 'Full name is required');
            isValid = false;
        }

        if (!email) {
            this.showFieldError(form.elements.email, 'Email is required');
            isValid = false;
        } else if (!this.isValidEmail(email)) {
            this.showFieldError(form.elements.email, 'Please enter a valid email');
            isValid = false;
        }

        if (!password) {
            this.showFieldError(form.elements.password, 'Password is required');
            isValid = false;
        } else if (password.length < 8) {
            this.showFieldError(form.elements.password, 'Password must be at least 8 characters');
            isValid = false;
        }

        if (!confirmPassword) {
            this.showFieldError(form.elements.confirmPassword, 'Confirm password is required');
            isValid = false;
        } else if (password !== confirmPassword) {
            this.showFieldError(form.elements.confirmPassword, 'Passwords do not match');
            isValid = false;
        }

        if (!terms) {
            this.showFieldError(form.elements.terms, 'You must accept the terms');
            isValid = false;
        }

        if (!isValid) return;

        // Submit
        this.setFormLoading(form, true);

        try {
            const response = await fetch(`${this.apiBaseUrl}/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, fullName })
            });

            const data = await response.json();

            if (response.ok) {
                this.showFormSuccess(form, 'Account created successfully! Redirecting to sign in...');
                await new Promise(resolve => setTimeout(resolve, 1500));
                this.showSignIn();
            } else {
                this.showFormError(form, data.error || 'Sign up failed. Please try again.');
            }
        } catch (error) {
            console.error('Sign up error:', error);
            this.showFormError(form, 'An error occurred. Please try again.');
        } finally {
            this.setFormLoading(form, false);
        }
    }

    async handleSignIn(e) {
        e.preventDefault();
        const form = e.target;
        const email = form.elements.email?.value?.trim();
        const password = form.elements.password?.value;

        this.clearFormErrors(form);

        let isValid = true;

        if (!email) {
            this.showFieldError(form.elements.email, 'Email is required');
            isValid = false;
        }

        if (!password) {
            this.showFieldError(form.elements.password, 'Password is required');
            isValid = false;
        }

        if (!isValid) return;

        this.setFormLoading(form, true);

        try {
            const response = await fetch(`${this.apiBaseUrl}/auth/signin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok && data.session) {
                // Verify we have all required session data
                if (!data.session.access_token) {
                    throw new Error('No access token received from server');
                }
                
                this.currentUser = data.user;
                this.accessToken = data.session.access_token;
                this.refreshToken = data.session.refresh_token;

                localStorage.setItem('accessToken', this.accessToken);
                localStorage.setItem('refreshToken', this.refreshToken);

                // Add a small delay to ensure localStorage is written
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Now show chat
                this.showChat();
            } else {
                this.showFormError(form, data.error || 'Sign in failed. Please try again.');
            }
        } catch (error) {
            console.error('Sign in error:', error);
            this.showFormError(form, 'An error occurred. Please try again.');
        } finally {
            this.setFormLoading(form, false);
        }
    }

    async handleForgotPassword(e) {
        e.preventDefault();
        const form = e.target;
        const email = form.elements.email?.value?.trim();

        this.clearFormErrors(form);

        if (!email) {
            this.showFieldError(form.elements.email, 'Email is required');
            return;
        }

        this.setFormLoading(form, true);

        try {
            const response = await fetch(`${this.apiBaseUrl}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (response.ok) {
                this.showFormSuccess(form, data.message || 'Password reset link sent! Check your email.');
                form.reset();
            } else {
                this.showFormError(form, data.error || 'Failed to send reset link.');
            }
        } catch (error) {
            console.error('Forgot password error:', error);
            this.showFormError(form, 'An error occurred. Please try again.');
        } finally {
            this.setFormLoading(form, false);
        }
    }

    async setupChatPage() {
        // Set user email in sidebar
        const userEmail = document.querySelector('.user-email');
        if (userEmail && this.currentUser) {
            userEmail.textContent = this.currentUser.email;
        }

        // Load conversations
        await this.loadConversations();

        // Setup auto-resize for composer
        const composerInput = document.querySelector('.composer-input');
        if (composerInput) {
            composerInput.addEventListener('input', () => {
                composerInput.style.height = 'auto';
                composerInput.style.height = Math.min(composerInput.scrollHeight, 150) + 'px';
            });
        }
    }

    async loadConversations() {
        try {
            const conversationsList = document.querySelector('.conversations-list');
            const loadingDiv = conversationsList.querySelector('.conversations-loading');
            
            loadingDiv.style.display = 'block';

            const response = await fetch(`${this.apiBaseUrl}/chat/conversations`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });

            if (response.ok) {
                const data = await response.json();
                this.conversations = data.conversations || [];
                this.renderConversations();
            } else if (response.status === 401) {
                await this.refreshAccessToken();
                await this.loadConversations();
            } else {
                console.error('Failed to load conversations');
                this.renderConversations();
            }
        } catch (error) {
            console.error('Load conversations error:', error);
            this.renderConversations();
        } finally {
            const loadingDiv = document.querySelector('.conversations-loading');
            if (loadingDiv) loadingDiv.style.display = 'none';
        }
    }

    renderConversations() {
        const conversationsList = document.querySelector('.conversations-list');
        const itemsContainer = conversationsList.querySelector('.conversations-list') || conversationsList;
        const existing = conversationsList.querySelectorAll('.conversation-item');
        existing.forEach(el => el.remove());

        if (this.conversations.length === 0) {
            const emptyDiv = conversationsList.querySelector('.conversations-empty');
            if (emptyDiv) {
                emptyDiv.style.display = 'block';
            }
            return;
        }

        const emptyDiv = conversationsList.querySelector('.conversations-empty');
        if (emptyDiv) {
            emptyDiv.style.display = 'none';
        }

        this.conversations.forEach(conv => {
            const item = document.createElement('div');
            item.className = `conversation-item ${this.currentConversation?.id === conv.id ? 'active' : ''}`;
            item.innerHTML = `
                <span class="conversation-title">${this.escapeHtml(conv.title)}</span>
                <div class="conversation-actions">
                    <button class="conversation-action-btn" onclick="event.stopPropagation(); app.renameConversation('${conv.id}')" title="Rename">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="conversation-action-btn" onclick="event.stopPropagation(); app.deleteConversation('${conv.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                    </button>
                </div>
            `;
            item.addEventListener('click', () => this.loadConversation(conv.id));
            
            // Find insertion point
            const loadingDiv = conversationsList.querySelector('.conversations-loading');
            if (loadingDiv) {
                conversationsList.insertBefore(item, loadingDiv);
            } else {
                conversationsList.appendChild(item);
            }
        });
    }

    async loadConversation(conversationId) {
        try {
            this.currentConversation = this.conversations.find(c => c.id === conversationId);
            
            const response = await fetch(
                `${this.apiBaseUrl}/chat/conversations/${conversationId}/messages`,
                { headers: { 'Authorization': `Bearer ${this.accessToken}` } }
            );

            if (response.ok) {
                const data = await response.json();
                this.renderMessages(data.messages || []);
            } else if (response.status === 401) {
                await this.refreshAccessToken();
                await this.loadConversation(conversationId);
            }
        } catch (error) {
            console.error('Load conversation error:', error);
        }

        this.renderConversations();
    }

    renderMessages(messages) {
        const messagesList = document.querySelector('.messages-list');
        const messagesEmpty = document.querySelector('.messages-empty');

        messagesList.innerHTML = '';

        if (messages.length === 0) {
            messagesEmpty.style.display = 'flex';
            return;
        }

        messagesEmpty.style.display = 'none';

        messages.forEach(msg => {
            const messageEl = document.createElement('div');
            messageEl.className = `message ${msg.role}`;
            messageEl.innerHTML = `
                <div class="message-avatar">${msg.role === 'user' ? 'You' : 'AI'}</div>
                <div class="message-content">
                    <div class="message-text">${this.escapeHtml(msg.content)}</div>
                    ${msg.role === 'assistant' ? `
                        <div class="message-actions">
                            <button class="message-action-btn" onclick="app.copyMessage('${this.escapeHtml(msg.content)}')" title="Copy">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                                </svg>
                                Copy
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
            messagesList.appendChild(messageEl);
        });

        // Scroll to bottom
        messagesList.parentElement.scrollTop = messagesList.parentElement.scrollHeight;
    }

    async sendMessage(e) {
        e.preventDefault();

        if (!this.currentConversation) {
            await this.createNewChat();
        }

        const composerInput = document.querySelector('.composer-input');
        const message = composerInput.value.trim();

        if (!message) return;

        composerInput.value = '';
        composerInput.style.height = 'auto';

        const composerButton = document.querySelector('.composer-button');
        composerButton.disabled = true;

        // Add user message to UI
        const messagesList = document.querySelector('.messages-list');
        const messagesEmpty = document.querySelector('.messages-empty');
        
        if (messagesEmpty.style.display !== 'none') {
            messagesEmpty.style.display = 'none';
        }

        const userMessageEl = document.createElement('div');
        userMessageEl.className = 'message user';
        userMessageEl.innerHTML = `
            <div class="message-avatar">You</div>
            <div class="message-content">
                <div class="message-text">${this.escapeHtml(message)}</div>
            </div>
        `;
        messagesList.appendChild(userMessageEl);
        messagesList.parentElement.scrollTop = messagesList.parentElement.scrollHeight;

        // Show loading indicator
        const loadingEl = document.createElement('div');
        loadingEl.className = 'message assistant loading';
        loadingEl.innerHTML = `
            <div class="message-avatar">AI</div>
            <div class="message-content">
                <span class="loader"></span>
            </div>
        `;
        messagesList.appendChild(loadingEl);
        messagesList.parentElement.scrollTop = messagesList.parentElement.scrollHeight;

        try {
            const response = await fetch(
                `${this.apiBaseUrl}/chat/conversations/${this.currentConversation.id}/messages`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.accessToken}`
                    },
                    body: JSON.stringify({ message })
                }
            );

            loadingEl.remove();

            if (response.ok) {
                const data = await response.json();
                
                const assistantMessageEl = document.createElement('div');
                assistantMessageEl.className = 'message assistant';
                assistantMessageEl.innerHTML = `
                    <div class="message-avatar">AI</div>
                    <div class="message-content">
                        <div class="message-text">${this.escapeHtml(data.assistantMessage)}</div>
                        <div class="message-actions">
                            <button class="message-action-btn" onclick="app.copyMessage('${this.escapeHtml(data.assistantMessage)}')" title="Copy">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                                </svg>
                                Copy
                            </button>
                        </div>
                    </div>
                `;
                messagesList.appendChild(assistantMessageEl);
                messagesList.parentElement.scrollTop = messagesList.parentElement.scrollHeight;

                // Update conversation in sidebar
                await this.loadConversations();
            } else if (response.status === 401) {
                await this.refreshAccessToken();
                loadingEl.innerHTML = `
                    <div class="message-avatar">AI</div>
                    <div class="message-content">
                        <div class="message-text">Failed to get response. Please try again.</div>
                    </div>
                `;
            } else {
                const data = await response.json();
                loadingEl.innerHTML = `
                    <div class="message-avatar">AI</div>
                    <div class="message-content">
                        <div class="message-text" style="color: var(--color-error);">${this.escapeHtml(data.error || 'Failed to get response')}</div>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Send message error:', error);
            loadingEl.innerHTML = `
                <div class="message-avatar">AI</div>
                <div class="message-content">
                    <div class="message-text" style="color: var(--color-error);">Connection error. Please try again.</div>
                </div>
            `;
        } finally {
            composerButton.disabled = false;
            composerInput.focus();
        }
    }

    async createNewChat() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/chat/conversations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.currentConversation = data.conversation;
                this.conversations.unshift(data.conversation);
                this.renderConversations();
                this.renderMessages([]);
                
                // Clear composer
                const composerInput = document.querySelector('.composer-input');
                if (composerInput) {
                    composerInput.focus();
                }
            } else if (response.status === 401) {
                await this.refreshAccessToken();
                await this.createNewChat();
            }
        } catch (error) {
            console.error('Create chat error:', error);
        }
    }

    async renameConversation(conversationId) {
        const conv = this.conversations.find(c => c.id === conversationId);
        if (!conv) return;

        const newTitle = prompt('Enter new title:', conv.title);
        if (!newTitle || newTitle.trim() === conv.title) return;

        try {
            const response = await fetch(
                `${this.apiBaseUrl}/chat/conversations/${conversationId}`,
                {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.accessToken}`
                    },
                    body: JSON.stringify({ title: newTitle.trim() })
                }
            );

            if (response.ok) {
                conv.title = newTitle.trim();
                this.renderConversations();
            } else if (response.status === 401) {
                await this.refreshAccessToken();
                await this.renameConversation(conversationId);
            }
        } catch (error) {
            console.error('Rename conversation error:', error);
        }
    }

    async deleteConversation(conversationId) {
        if (!confirm('Are you sure you want to delete this conversation?')) return;

        try {
            const response = await fetch(
                `${this.apiBaseUrl}/chat/conversations/${conversationId}`,
                {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${this.accessToken}` }
                }
            );

            if (response.ok) {
                this.conversations = this.conversations.filter(c => c.id !== conversationId);
                if (this.currentConversation?.id === conversationId) {
                    this.currentConversation = null;
                    this.renderMessages([]);
                }
                this.renderConversations();
            } else if (response.status === 401) {
                await this.refreshAccessToken();
                await this.deleteConversation(conversationId);
            }
        } catch (error) {
            console.error('Delete conversation error:', error);
        }
    }

    copyMessage(text) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Copied to clipboard!');
        }).catch(() => {
            alert('Failed to copy');
        });
    }

    insertPrompt(prompt) {
        const composerInput = document.querySelector('.composer-input');
        if (composerInput) {
            composerInput.value = prompt;
            composerInput.focus();
        }
    }

    toggleSidebar() {
        const sidebar = document.querySelector('.chat-sidebar');
        const container = document.querySelector('.chat-container');
        
        if (sidebar) {
            sidebar.classList.toggle('open');
        }
        
        if (container) {
            container.classList.toggle('sidebar-open');
        }
    }

    toggleAccountMenu() {
        const menu = document.querySelector('.account-menu');
        if (menu) {
            menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
        }
    }

    handleComposerKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const form = e.target.closest('.composer-form');
            if (form) form.dispatchEvent(new Event('submit'));
        }
    }

    signOut() {
        this.clearAuth();
        this.showLanding();
    }

    clearAuth() {
        this.currentUser = null;
        this.accessToken = null;
        this.refreshToken = null;
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
    }

    // Form helpers
    clearFormErrors(form) {
        form.querySelectorAll('.field-error').forEach(el => el.textContent = '');
        const generalError = form.querySelector('.form-error');
        if (generalError) generalError.style.display = 'none';
        const generalSuccess = form.querySelector('.form-success');
        if (generalSuccess) generalSuccess.style.display = 'none';
    }

    showFieldError(field, message) {
        const errorEl = field.parentElement.querySelector('.field-error');
        if (errorEl) {
            errorEl.textContent = message;
        }
    }

    showFormError(form, message) {
        const errorEl = form.querySelector('.form-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    showFormSuccess(form, message) {
        const successEl = form.querySelector('.form-success');
        if (successEl) {
            successEl.textContent = message;
            successEl.style.display = 'block';
        }
    }

    setFormLoading(form, loading) {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = loading;
            const textSpan = submitBtn.querySelector('.btn-text');
            const loaderSpan = submitBtn.querySelector('.btn-loader');
            if (textSpan && loaderSpan) {
                textSpan.style.display = loading ? 'none' : 'inline';
                loaderSpan.style.display = loading ? 'inline' : 'none';
            }
        }
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize app
const app = new EMOVA();
