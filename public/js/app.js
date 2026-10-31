import { VoiceControls } from './voice.js';

class EMOVA {
    constructor() {
        this.currentPage = 'landing';
        this.currentUser = null;
        this.currentConversation = null;
        this.conversations = [];
        this.accessToken = null;
        this.refreshToken = null;
        this.apiBaseUrl = '/api';
        this.models = [];
        this.selectedModel = localStorage.getItem('selectedModel') || '';
        this.activeChatController = null;
        this.failedMessage = '';
        this.refreshPromise = null;
        this.pendingAvatarFile = null;
        this.pendingAvatarRemoval = false;
        this.currentProfileAvatarUrl = null;
        this.voice = new VoiceControls({
            onTranscript: text => this.updateVoiceTranscript(text),
            onRecordingState: (state, message) => this.updateRecordingState(state, message)
        });
        localStorage.removeItem('voiceAutoRead');
        localStorage.removeItem('voiceURI');

        this.init();
    }

    async init() {
        this.setupTheme();
        this.attachEventListeners();
        if (await this.handlePasswordRecovery()) return;
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
        this.updateThemeControls();
    }

    updateThemeControls() {
        const theme = document.documentElement.classList.contains('light-theme') ? 'light' : 'dark';
        document.querySelectorAll('[data-action="set-theme"]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.themeValue === theme));
        });
    }

    toggleTheme() {
        const html = document.documentElement;
        const isLight = html.classList.contains('light-theme');
        this.setTheme(isLight ? 'dark' : 'light');
    }

    attachEventListeners() {
        // Remove existing listeners by replacing with once=true setup
        // This prevents duplicate event handlers

        // Navigation actions using data attributes (with event delegation)
        document.addEventListener('click', (e) => {
            const chatAction = e.target.closest('[data-chat-action]')?.dataset.chatAction;
            const voiceAction = e.target.closest('[data-voice-action]')?.dataset.voiceAction;
            if (voiceAction === 'record') {
                this.toggleVoiceRecording();
            } else if (voiceAction === 'cancel-recording') {
                this.voice.cancelRecording();
            }
            if (chatAction === 'stop-response') {
                this.activeChatController?.abort();
            } else if (chatAction === 'retry-message') {
                this.sendMessage(null, this.failedMessage);
            } else if (chatAction === 'dismiss-chat-status') {
                this.setChatStatus('');
            }

            const action = e.target.closest('[data-action]')?.dataset.action;
            
            if (!action) return;
            
            // Prevent default for buttons
            if (e.target.closest('button')) {
                e.preventDefault();
            }
            
            const btn = e.target.closest('[data-action]');
            
            switch (action) {
                case 'show-signup':
                    this.showSignUp();
                    break;
                case 'show-signin':
                    this.showSignIn();
                    break;
                case 'show-landing':
                    this.showLanding();
                    break;
                case 'show-forgot-password':
                    this.showForgotPassword();
                    break;
                case 'create-new-chat':
                    this.createNewChat();
                    break;
                case 'toggle-account-menu':
                    this.toggleAccountMenu();
                    break;
                case 'sign-out':
                    this.signOut();
                    break;
                case 'toggle-sidebar':
                    this.toggleSidebar();
                    break;
                case 'show-image-prompt':
                    this.showImagePromptDialog();
                    break;
                case 'show-settings':
                    this.showSettings();
                    break;
                case 'show-chat':
                    this.showChat();
                    break;
                case 'remove-profile-avatar':
                    this.removeProfileAvatarPreview();
                    break;
                case 'request-password-reset':
                    this.requestSettingsPasswordReset();
                    break;
                case 'set-theme':
                    this.setTheme(btn.dataset.themeValue);
                    this.setSettingsMessage('appearance-settings-message', 'Theme preference saved on this device.', 'success');
                    break;
                case 'download-image':
                    this.downloadImage(
                        btn.dataset.imageId,
                        btn.closest('.message')?.querySelector('.message-image')?.src,
                        btn.dataset.imagePrompt.substring(0, 30)
                    );
                    break;
                case 'regenerate-image':
                    this.regenerateImage(btn.dataset.imagePrompt);
                    break;
                case 'insert-prompt':
                    this.insertPrompt(btn.dataset.prompt);
                    break;
                case 'copy-message':
                    this.copyMessage(btn.dataset.content);
                    break;
                case 'rename-conversation':
                    e.stopPropagation();
                    this.renameConversation(btn.dataset.conversationId);
                    break;
                case 'delete-conversation':
                    e.stopPropagation();
                    this.deleteConversation(btn.dataset.conversationId);
                    break;
            }
        });

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

        // Sidebar close
        const sidebarClose = document.querySelector('.sidebar-close');
        if (sidebarClose) {
            sidebarClose.addEventListener('click', () => this.toggleSidebar());
        }

        // Account menu close on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.sidebar-footer') && document.querySelector('.account-menu')?.style.display === 'flex') {
                document.querySelector('.account-menu').style.display = 'none';
            }
        });
    }

    attachFormListeners() {
        // Attach form listeners - called once per page render
        // These are attached to specific forms, not document level

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

        // Composer form
        const composerForm = document.querySelector('.composer-form');
        if (composerForm) {
            composerForm.addEventListener('submit', (e) => this.sendMessage(e));
        }

        // Composer input
        const composerInput = document.querySelector('.composer-input');
        if (composerInput) {
            composerInput.addEventListener('keydown', (e) => this.handleComposerKeydown(e));
        }

        const modelSelector = document.querySelector('.model-selector');
        if (modelSelector) {
            modelSelector.addEventListener('change', () => this.selectModel(modelSelector.value));
        }

        const profileForm = document.getElementById('profile-settings-form');
        if (profileForm) profileForm.addEventListener('submit', event => this.saveSettingsProfile(event));
        const emailForm = document.getElementById('email-settings-form');
        if (emailForm) emailForm.addEventListener('submit', event => this.requestEmailChange(event));
        const passwordForm = document.getElementById('password-settings-form');
        if (passwordForm) passwordForm.addEventListener('submit', event => this.updateSettingsPassword(event));
        const resetPasswordForm = document.getElementById('reset-password-form');
        if (resetPasswordForm) resetPasswordForm.addEventListener('submit', event => this.completePasswordReset(event));
        const avatarInput = document.getElementById('profile-avatar-file');
        if (avatarInput) avatarInput.addEventListener('change', () => this.previewProfileAvatar(avatarInput.files?.[0]));
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
        if (pageName !== 'chat') {
            this.voice.cancelRecording();
        }
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
        
        // Attach form-specific listeners for this page
        this.attachFormListeners();

        // Page-specific setup
        if (pageName === 'landing') {
            this.setupPasswordToggles();
        } else if (pageName === 'chat') {
            // Give page time to render before setup
            setTimeout(() => this.setupChatPage(), 0);
        } else if (pageName === 'settings') {
            this.updateThemeControls();
            this.loadSettingsProfile();
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

    showSettings() {
        if (!this.accessToken || !this.currentUser) {
            this.showSignIn();
            return;
        }
        this.showPage('settings');
    }

    async handlePasswordRecovery() {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const accessToken = params.get('access_token');
        if (params.get('type') !== 'recovery' || !accessToken) return false;

        this.accessToken = accessToken;
        this.refreshToken = params.get('refresh_token');
        localStorage.setItem('accessToken', this.accessToken);
        if (this.refreshToken) localStorage.setItem('refreshToken', this.refreshToken);
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        this.showPage('reset-password');
        return true;
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
                const refreshed = await this.refreshAccessToken();
                if (refreshed) {
                    // After refresh, try loading chat again
                    const retryResponse = await fetch(`${this.apiBaseUrl}/auth/user`, {
                        headers: { 'Authorization': `Bearer ${this.accessToken}` }
                    });
                    if (retryResponse.ok) {
                        const userData = await retryResponse.json();
                        this.currentUser = userData.user;
                        this.showChat();
                    } else {
                        this.clearAuth();
                        this.showLanding();
                    }
                } else {
                    this.clearAuth();
                    this.showLanding();
                }
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
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        this.refreshPromise = this.performTokenRefresh();
        try {
            return await this.refreshPromise;
        } finally {
            this.refreshPromise = null;
        }
    }

    async performTokenRefresh() {
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

    async authenticatedFetch(url, options = {}) {
        const requestOptions = {
            ...options,
            headers: {
                ...options.headers,
                Authorization: `Bearer ${this.accessToken}`
            }
        };
        let response = await fetch(url, requestOptions);
        if (response.status !== 401) {
            return response;
        }

        if (!this.refreshToken || !await this.refreshAccessToken()) {
            if (this.currentPage === 'settings') {
                this.clearAuth();
                this.showSignIn();
            }
            return response;
        }

        response = await fetch(url, {
            ...requestOptions,
            headers: {
                ...requestOptions.headers,
                Authorization: `Bearer ${this.accessToken}`
            }
        });
        if (response.status === 401 && this.currentPage === 'settings') {
            this.clearAuth();
            this.showSignIn();
        }
        return response;
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

            // Check if response is OK before trying to parse JSON
            let data;
            try {
                data = await response.json();
            } catch (jsonError) {
                console.error('Failed to parse server response:', jsonError);
                this.showFormError(form, 'Server error. Please try again.');
                return;
            }

            if (response.ok) {
                // Check if we got a session (email confirmation disabled)
                if (data.session && data.session.access_token) {
                    // Auto-login after signup
                    this.currentUser = data.user;
                    this.accessToken = data.session.access_token;
                    this.refreshToken = data.session.refresh_token;

                    localStorage.setItem('accessToken', this.accessToken);
                    localStorage.setItem('refreshToken', this.refreshToken);

                    this.showFormSuccess(form, 'Account created successfully! Redirecting to chat...');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    this.showChat();
                } else if (data.requiresEmailVerification) {
                    // Email confirmation required - user cannot sign in yet
                    this.showFormSuccess(form, 'Account created! Please check your email and click the verification link before signing in.');
                    // Don't auto-redirect - let user read the message
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.showSignIn();
                } else {
                    // Email confirmation required (fallback)
                    this.showFormSuccess(form, data.message || 'Account created! Please verify your email before signing in.');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.showSignIn();
                }
            } else if (response.status === 429) {
                // Rate limit error
                this.showFormError(form, data.error || 'Too many signup attempts. Please try again in a few minutes.');
            } else {
                this.showFormError(form, data.error || 'Sign up failed. Please try again.');
            }
        } catch (error) {
            console.error('Sign up error:', error);

            // More specific error messages
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                this.showFormError(form, 'Cannot connect to server. Please check your connection and try again.');
            } else if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
                this.showFormError(form, 'Network error. Please check your connection and try again.');
            } else {
                this.showFormError(form, 'An error occurred. Please try again.');
            }
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

    setSettingsMessage(elementId, message, type = '') {
        const element = document.getElementById(elementId);
        if (!element) return;
        element.textContent = message;
        element.classList.toggle('is-success', type === 'success');
        element.classList.toggle('is-error', type === 'error');
    }

    async loadSettingsProfile() {
        this.setSettingsMessage('settings-page-status', 'Loading your account settings…');
        const status = document.getElementById('settings-page-status');
        if (status) status.hidden = false;

        try {
            const response = await this.authenticatedFetch(`${this.apiBaseUrl}/settings/profile`);
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.profile) {
                if (response.status === 401) {
                    this.clearAuth();
                    this.showSignIn();
                    return;
                }
                throw new Error(data.error || 'Could not load your profile.');
            }

            const profile = data.profile;
            document.getElementById('profile-display-name').value = profile.displayName || '';
            document.getElementById('profile-current-email').textContent = profile.email || '';
            document.getElementById('email-current').value = profile.email || '';
            document.getElementById('profile-created-at').textContent = profile.accountCreatedAt
                ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(profile.accountCreatedAt))
                : 'Not available';
            const avatar = document.getElementById('profile-avatar-preview');
            this.currentProfileAvatarUrl = profile.avatarUrl;
            if (avatar) avatar.src = profile.avatarUrl || '/images/emova-logo.svg';
            this.pendingAvatarFile = null;
            this.pendingAvatarRemoval = false;

            if (profile.pendingEmail) {
                this.setSettingsMessage(
                    'email-settings-message',
                    `Verification is pending for ${profile.pendingEmail}. Check that inbox to finish the change.`
                );
            }
            this.setSettingsMessage('settings-page-status', '');
            if (status) status.hidden = true;
        } catch (error) {
            this.setSettingsMessage('settings-page-status', error.message || 'Could not load your profile.', 'error');
            if (status) status.hidden = false;
        }
    }

    previewProfileAvatar(file) {
        const input = document.getElementById('profile-avatar-file');
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
            if (input) input.value = '';
            this.setSettingsMessage('profile-settings-message', 'Choose a JPEG, PNG, or WebP image up to 5 MB.', 'error');
            return;
        }

        this.pendingAvatarFile = file;
        this.pendingAvatarRemoval = false;
        const avatar = document.getElementById('profile-avatar-preview');
        if (avatar) {
            if (avatar.dataset.previewUrl) URL.revokeObjectURL(avatar.dataset.previewUrl);
            const previewUrl = URL.createObjectURL(file);
            avatar.dataset.previewUrl = previewUrl;
            avatar.src = previewUrl;
        }
        this.setSettingsMessage('profile-settings-message', 'Image preview ready. Save profile to apply it.');
    }

    removeProfileAvatarPreview() {
        if (!window.confirm('Remove your profile picture? Save your profile to confirm.')) return;
        this.pendingAvatarFile = null;
        this.pendingAvatarRemoval = true;
        const avatar = document.getElementById('profile-avatar-preview');
        if (avatar) {
            if (avatar.dataset.previewUrl) URL.revokeObjectURL(avatar.dataset.previewUrl);
            delete avatar.dataset.previewUrl;
            avatar.src = '/images/emova-logo.svg';
        }
        const input = document.getElementById('profile-avatar-file');
        if (input) input.value = '';
        this.setSettingsMessage('profile-settings-message', 'Picture will be removed when you save your profile.');
    }

    async saveSettingsProfile(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const displayName = form.elements.displayName.value.trim();
        if (!displayName || displayName.length > 80) {
            this.setSettingsMessage('profile-settings-message', 'Display name must be between 1 and 80 characters.', 'error');
            return;
        }

        this.setFormLoading(form, true);
        try {
            const response = await this.authenticatedFetch(`${this.apiBaseUrl}/settings/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Could not save your profile.');

            if (this.pendingAvatarFile) {
                const avatarResponse = await this.authenticatedFetch(`${this.apiBaseUrl}/settings/profile/avatar`, {
                    method: 'POST',
                    headers: { 'Content-Type': this.pendingAvatarFile.type },
                    body: this.pendingAvatarFile
                });
                const avatarData = await avatarResponse.json().catch(() => ({}));
                if (!avatarResponse.ok) {
                    throw new Error(`Display name saved, but profile picture was not saved: ${avatarData.error || 'Please try again.'}`);
                }
                this.currentProfileAvatarUrl = avatarData.avatarUrl;
            } else if (this.pendingAvatarRemoval) {
                const avatarResponse = await this.authenticatedFetch(`${this.apiBaseUrl}/settings/profile/avatar`, {
                    method: 'DELETE'
                });
                const avatarData = await avatarResponse.json().catch(() => ({}));
                if (!avatarResponse.ok) {
                    throw new Error(avatarData.error || 'Display name saved, but profile picture could not be removed.');
                }
                this.currentProfileAvatarUrl = null;
            }

            const avatar = document.getElementById('profile-avatar-preview');
            if (avatar) {
                if (avatar.dataset.previewUrl) URL.revokeObjectURL(avatar.dataset.previewUrl);
                delete avatar.dataset.previewUrl;
                avatar.src = this.currentProfileAvatarUrl || '/images/emova-logo.svg';
            }
            this.pendingAvatarFile = null;
            this.pendingAvatarRemoval = false;
            const input = document.getElementById('profile-avatar-file');
            if (input) input.value = '';
            this.setSettingsMessage('profile-settings-message', 'Profile changes saved.', 'success');
        } catch (error) {
            this.setSettingsMessage('profile-settings-message', error.message || 'Could not save your profile.', 'error');
        } finally {
            this.setFormLoading(form, false);
        }
    }

    async requestEmailChange(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const email = form.elements.email.value.trim();
        if (!this.isValidEmail(email)) {
            this.setSettingsMessage('email-settings-message', 'Enter a valid email address.', 'error');
            return;
        }

        this.setFormLoading(form, true);
        try {
            const response = await this.authenticatedFetch(`${this.apiBaseUrl}/settings/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Could not request an email change.');
            this.setSettingsMessage(
                'email-settings-message',
                `${data.message} Pending: ${data.pendingEmail}`,
                'success'
            );
            form.reset();
        } catch (error) {
            this.setSettingsMessage('email-settings-message', error.message || 'Could not request an email change.', 'error');
        } finally {
            this.setFormLoading(form, false);
        }
    }

    async updateSettingsPassword(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const password = form.elements.password.value;
        const confirmPassword = form.elements.confirmPassword.value;
        if (password.length < 8 || password.length > 128) {
            this.setSettingsMessage('password-settings-message', 'Password must be between 8 and 128 characters.', 'error');
            return;
        }
        if (password !== confirmPassword) {
            this.setSettingsMessage('password-settings-message', 'Passwords do not match.', 'error');
            return;
        }

        this.setFormLoading(form, true);
        try {
            const response = await this.authenticatedFetch(`${this.apiBaseUrl}/settings/password`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, confirmPassword })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Could not update your password.');
            form.reset();
            this.setSettingsMessage('password-settings-message', data.message, 'success');
        } catch (error) {
            this.setSettingsMessage('password-settings-message', error.message || 'Could not update your password.', 'error');
        } finally {
            this.setFormLoading(form, false);
        }
    }

    async requestSettingsPasswordReset() {
        const email = document.getElementById('email-current')?.value || this.currentUser?.email;
        if (!email) {
            this.setSettingsMessage('password-settings-message', 'Your account email is not available.', 'error');
            return;
        }
        try {
            const response = await fetch(`${this.apiBaseUrl}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Could not request a reset email.');
            this.setSettingsMessage('password-settings-message', data.message, 'success');
        } catch (error) {
            this.setSettingsMessage('password-settings-message', error.message || 'Could not request a reset email.', 'error');
        }
    }

    async completePasswordReset(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const password = form.elements.password.value;
        const confirmPassword = form.elements.confirmPassword.value;
        if (password.length < 8 || password !== confirmPassword) {
            this.showFormError(form, password.length < 8
                ? 'Password must be at least 8 characters.'
                : 'Passwords do not match.');
            return;
        }

        this.setFormLoading(form, true);
        try {
            const response = await this.authenticatedFetch(`${this.apiBaseUrl}/settings/password`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, confirmPassword })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Could not update your password.');
            this.clearAuth();
            this.showSignIn();
            const notice = document.createElement('div');
            notice.className = 'form-success';
            notice.textContent = 'Password updated. Sign in with your new password.';
            document.getElementById('signin-form')?.prepend(notice);
        } catch (error) {
            this.showFormError(form, error.message || 'Could not update your password.');
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

        if (this.browserSpeechRecognitionAvailable()) {
            const voiceButton = document.querySelector('.voice-input-button');
            if (voiceButton) voiceButton.disabled = false;
        } else {
            this.updateRecordingState('unsupported', 'Speech recognition is not supported in this browser.');
        }
        await Promise.all([this.loadModels(), this.loadConversations()]);

        // Setup auto-resize for composer
        const composerInput = document.querySelector('.composer-input');
        if (composerInput) {
            composerInput.addEventListener('input', () => {
                composerInput.style.height = 'auto';
                composerInput.style.height = Math.min(composerInput.scrollHeight, 150) + 'px';
            });
        }
    }

    browserSpeechRecognitionAvailable() {
        return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    toggleVoiceRecording() {
        const input = document.querySelector('.composer-input');
        if (!input) return;
        if (!this.browserSpeechRecognitionAvailable()) {
            this.updateRecordingState('unsupported', 'Speech recognition is not supported in this browser.');
            return;
        }
        this.voice.startRecording(input.value);
    }

    updateVoiceTranscript(text) {
        const input = document.querySelector('.composer-input');
        if (!input) return;
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }

    updateRecordingState(state, message) {
        const button = document.querySelector('.voice-input-button');
        const cancelButton = document.querySelector('.voice-cancel-button');
        const status = document.querySelector('.voice-status');
        if (button) {
            button.classList.toggle('is-recording', state === 'recording');
            button.setAttribute('aria-label', state === 'recording' ? 'Recording voice input' : 'Start voice input');
            button.title = state === 'recording' ? 'Recording…' : 'Start voice input';
        }
        if (cancelButton) cancelButton.hidden = state !== 'recording';
        if (status) {
            status.textContent = message;
            status.classList.toggle('is-error', state === 'error' || state === 'unsupported');
        }
    }

    async loadModels() {
        const selector = document.querySelector('.model-selector');
        const status = document.querySelector('.model-status');
        if (!selector) return;

        selector.disabled = true;
        selector.innerHTML = '<option value="">Loading available models…</option>';
        if (status) status.textContent = '';

        try {
            const response = await this.authenticatedFetch(`${this.apiBaseUrl}/chat/models`);
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'Unable to load model list.');
            }

            this.models = data.models || [];
            if (data.catalogStale && status) {
                status.textContent = data.warning || 'Showing cached models; the catalogue is temporarily unavailable.';
            }
            selector.replaceChildren();

            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select a model';
            selector.appendChild(placeholder);

            const families = ['GPT', 'Gemini', 'Claude', 'Grok'];
            for (const family of families) {
                const familyModels = this.models.filter(model => model.family === family);
                if (!familyModels.length) continue;

                const group = document.createElement('optgroup');
                group.label = family;
                for (const model of familyModels) {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.name;
                    group.appendChild(option);
                }
                selector.appendChild(group);
            }

            const configuredDefault = this.models.some(model => model.id === data.defaultModel)
                ? data.defaultModel
                : '';
            const savedSelection = this.models.some(model => model.id === this.selectedModel)
                ? this.selectedModel
                : configuredDefault;
            selector.value = savedSelection;
            this.selectModel(savedSelection, false);
            selector.disabled = this.models.length === 0;
            if (!this.models.length && status) {
                status.textContent = 'No supported OpenRouter models are currently listed.';
            }
        } catch (error) {
            selector.replaceChildren(new Option('Models unavailable', ''));
            selector.disabled = true;
            if (status) status.textContent = error.message;
        }
    }

    selectModel(modelId, persist = true) {
        const model = this.models.find(candidate => candidate.id === modelId);
        this.selectedModel = model ? model.id : '';
        if (persist) {
            if (this.selectedModel) {
                localStorage.setItem('selectedModel', this.selectedModel);
            } else {
                localStorage.removeItem('selectedModel');
            }
        }

        const label = document.querySelector('.active-model-label');
        if (label) {
            label.textContent = model ? `Active model: ${model.name}` : 'Choose a model to start';
        }
    }

    setChatStatus(message, { error = false, retry = false } = {}) {
        const status = document.querySelector('.chat-status');
        if (!status) return;
        status.replaceChildren();
        status.hidden = !message;
        status.classList.toggle('is-error', error);
        if (!message) return;

        const text = document.createElement('span');
        text.textContent = message;
        status.appendChild(text);
        if (retry) {
            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.className = 'chat-status-action';
            retryButton.dataset.chatAction = 'retry-message';
            retryButton.textContent = 'Retry';
            status.appendChild(retryButton);
        }
        const dismissButton = document.createElement('button');
        dismissButton.type = 'button';
        dismissButton.className = 'chat-status-action';
        dismissButton.dataset.chatAction = 'dismiss-chat-status';
        dismissButton.textContent = 'Dismiss';
        status.appendChild(dismissButton);
    }

    async loadConversations() {
        try {
            const conversationsList = document.querySelector('.conversations-list');
            const loadingDiv = conversationsList.querySelector('.conversations-loading');
            
            loadingDiv.style.display = 'block';

            const response = await this.authenticatedFetch(`${this.apiBaseUrl}/chat/conversations`);

            if (response.ok) {
                const data = await response.json();
                this.conversations = data.conversations || [];
                this.renderConversations();
            } else {
                this.setChatStatus('Could not load conversation history. Please refresh and try again.', {
                    error: true
                });
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
                    <button class="conversation-action-btn" data-action="rename-conversation" data-conversation-id="${conv.id}" title="Rename">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="conversation-action-btn" data-action="delete-conversation" data-conversation-id="${conv.id}" title="Delete">
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
        this.voice.cancelRecording();
        try {
            this.currentConversation = this.conversations.find(c => c.id === conversationId);
            
            const response = await this.authenticatedFetch(
                `${this.apiBaseUrl}/chat/conversations/${conversationId}/messages`,
            );

            if (response.ok) {
                const data = await response.json();
                this.renderMessages(data.messages || []);
            } else {
                const data = await response.json().catch(() => ({}));
                this.setChatStatus(data.error || 'Could not load this conversation.', { error: true });
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
                <div class="message-content">
                    <div class="message-text">${this.escapeHtml(msg.content)}</div>
                    ${msg.role === 'assistant' ? `
                        <div class="message-actions">
                            <button class="message-action-btn" data-action="copy-message" data-content="${this.escapeHtml(msg.content)}" title="Copy">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                                </svg>
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

    async sendMessage(e, retryMessage = null) {
        e?.preventDefault();
        if (this.activeChatController) return;

        const composerInput = document.querySelector('.composer-input');
        const message = (retryMessage ?? composerInput?.value ?? '').trim();
        if (!message) return;

        if (!this.selectedModel) {
            this.setChatStatus('Choose an AI model before sending your message.', { error: true });
            return;
        }

        if (!this.currentConversation) {
            const created = await this.createNewChat();
            if (!created || !this.currentConversation) {
                this.setChatStatus('Could not start a conversation. Your message is still here; try again.', {
                    error: true,
                    retry: true
                });
                this.failedMessage = message;
                return;
            }
        }

        const messagesList = document.querySelector('.messages-list');
        const messagesEmpty = document.querySelector('.messages-empty');
        const submitButton = document.querySelector('.composer-form button[type="submit"]');
        const stopButton = document.querySelector('[data-chat-action="stop-response"]');
        const status = document.querySelector('.chat-status');
        const userMessageEl = document.createElement('div');
        userMessageEl.className = 'message user pending';
        userMessageEl.innerHTML = `
            <div class="message-content"><div class="message-text">${this.escapeHtml(message)}</div></div>
        `;
        messagesList.appendChild(userMessageEl);
        if (messagesEmpty) messagesEmpty.style.display = 'none';

        const loadingEl = document.createElement('div');
        loadingEl.className = 'message assistant loading';
        loadingEl.innerHTML = `
            <div class="message-content"><span class="loader"></span><span class="loading-label">Waiting for ${this.escapeHtml(this.models.find(model => model.id === this.selectedModel)?.name || this.selectedModel)}…</span></div>
        `;
        messagesList.appendChild(loadingEl);
        messagesList.parentElement.scrollTop = messagesList.parentElement.scrollHeight;
        this.setChatStatus('');
        this.failedMessage = '';
        this.activeChatController = new AbortController();
        if (composerInput) composerInput.disabled = true;
        if (submitButton) submitButton.disabled = true;
        if (stopButton) stopButton.hidden = false;
        if (status) status.setAttribute('aria-busy', 'true');

        let succeeded = false;
        try {
            const response = await this.authenticatedFetch(
                `${this.apiBaseUrl}/chat/conversations/${this.currentConversation.id}/messages`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, model: this.selectedModel }),
                    signal: this.activeChatController.signal
                }
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true || !data.assistantMessage) {
                const error = data.error || (response.status === 401
                    ? 'Your session expired. Sign in again, then retry your message.'
                    : 'The AI provider could not complete your request.');
                throw new Error(error);
            }

            const assistantMessageEl = document.createElement('div');
            assistantMessageEl.className = 'message assistant';
            assistantMessageEl.innerHTML = `
                <div class="message-content">
                    <div class="message-text">${this.escapeHtml(data.assistantMessage)}</div>
                    <div class="message-model">${this.escapeHtml(data.modelName || data.model || 'AI model')}</div>
                    <div class="message-actions">
                        <button class="message-action-btn" data-action="copy-message" data-content="${this.escapeHtml(data.assistantMessage)}" title="Copy">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
            loadingEl.replaceWith(assistantMessageEl);
            userMessageEl.classList.remove('pending');
            const activeModelLabel = document.querySelector('.active-model-label');
            if (activeModelLabel) activeModelLabel.textContent = `Active model: ${data.modelName || data.model}`;
            if (composerInput?.value.trim() === message) {
                composerInput.value = '';
                composerInput.style.height = 'auto';
            }
            succeeded = true;
            await this.loadConversations();
        } catch (error) {
            userMessageEl.remove();
            loadingEl.remove();
            if (messagesList.children.length === 0 && messagesEmpty) {
                messagesEmpty.style.display = 'flex';
            }
            this.failedMessage = message;
            this.setChatStatus(
                error.name === 'AbortError' ? 'Response stopped. Your message was not submitted; retry when ready.' : error.message,
                { error: true, retry: true }
            );
        } finally {
            this.activeChatController = null;
            if (composerInput) {
                composerInput.disabled = false;
                composerInput.focus();
            }
            if (submitButton) submitButton.disabled = false;
            if (stopButton) stopButton.hidden = true;
            if (status) status.removeAttribute('aria-busy');
            if (succeeded) this.failedMessage = '';
        }
    }

    async createNewChat() {
        this.voice.cancelRecording();
        try {
            const response = await this.authenticatedFetch(`${this.apiBaseUrl}/chat/conversations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
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

                return true;
            } else {
                const errorData = await response.json();
                console.error('Failed to create conversation:', errorData);
                this.setChatStatus(errorData.error || 'Could not create a conversation.', { error: true });
                return false;
            }
        } catch (error) {
            console.error('Create chat error:', error);
            return false;
        }
    }

    async renameConversation(conversationId) {
        const conv = this.conversations.find(c => c.id === conversationId);
        if (!conv) return;

        const newTitle = prompt('Enter new title:', conv.title);
        if (!newTitle || newTitle.trim() === conv.title) return;

        try {
            const response = await this.authenticatedFetch(
                `${this.apiBaseUrl}/chat/conversations/${conversationId}`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: newTitle.trim() })
                }
            );

            if (response.ok) {
                conv.title = newTitle.trim();
                this.renderConversations();
            } else {
                const data = await response.json().catch(() => ({}));
                this.setChatStatus(data.error || 'Could not rename this conversation.', { error: true });
            }
        } catch (error) {
            console.error('Rename conversation error:', error);
        }
    }

    async deleteConversation(conversationId) {
        if (!confirm('Are you sure you want to delete this conversation?')) return;

        try {
            const response = await this.authenticatedFetch(
                `${this.apiBaseUrl}/chat/conversations/${conversationId}`,
                {
                    method: 'DELETE',
                }
            );

            if (response.ok) {
                this.conversations = this.conversations.filter(c => c.id !== conversationId);
                if (this.currentConversation?.id === conversationId) {
                    this.currentConversation = null;
                    this.renderMessages([]);
                }
                this.renderConversations();
            } else {
                const data = await response.json().catch(() => ({}));
                this.setChatStatus(data.error || 'Could not delete this conversation.', { error: true });
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

    async signOut() {
        if (this.accessToken) {
            try {
                await fetch(`${this.apiBaseUrl}/settings/signout`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${this.accessToken}` }
                });
            } catch (error) {
                console.error('Remote sign-out could not be completed.');
            }
        }
        this.clearAuth();
        this.showSignIn();
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
        // RFC 5322 simplified email validation
        // Allows: localpart@domain.extension
        // Supports: dots, hyphens, underscores in local part and domain
        const emailRegex = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return emailRegex.test(email);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Image Generation Methods
    async generateImage(prompt) {
        if (!this.currentConversation) {
            alert('Please create a chat first');
            return;
        }

        if (!prompt || prompt.trim().length === 0) {
            alert('Please enter an image description');
            return;
        }

        const trimmedPrompt = prompt.trim();

        // Add prompt to UI as user message
        const messagesList = document.querySelector('.messages-list');
        const userMessageEl = document.createElement('div');
        userMessageEl.className = 'message user';
        userMessageEl.innerHTML = `
            <div class="message-avatar">You</div>
            <div class="message-content">
                <div class="message-text">Generate image: "${this.escapeHtml(trimmedPrompt)}"</div>
            </div>
        `;
        messagesList.appendChild(userMessageEl);

        // Show loading indicator
        const loadingEl = document.createElement('div');
        loadingEl.className = 'message assistant loading';
        loadingEl.innerHTML = `
            <div class="message-avatar">AI</div>
            <div class="message-content">
                <span class="loader"></span>
                <span style="margin-left: 10px;">Generating image...</span>
            </div>
        `;
        messagesList.appendChild(loadingEl);
        messagesList.parentElement.scrollTop = messagesList.parentElement.scrollHeight;

        try {
            const response = await fetch(`${this.apiBaseUrl}/images/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.accessToken}`
                },
                body: JSON.stringify({ prompt: trimmedPrompt })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.imageUrl) {
                const message = data.error || 'Failed to generate image. Please try again.';
                loadingEl.classList.remove('loading');
                loadingEl.innerHTML = `
                    <div class="message-content">
                        <div class="message-text" style="color: var(--color-error);">${this.escapeHtml(message)}</div>
                    </div>
                `;
                return;
            }

            loadingEl.remove();
            {
                const imageMessageEl = document.createElement('div');
                imageMessageEl.className = 'message assistant';
                imageMessageEl.innerHTML = `
                    <div class="message-avatar">AI</div>
                    <div class="message-content">
                        <div class="message-text">Generated image:</div>
                        <div class="message-image-container" style="margin-top: 10px;">
                            <img class="message-image" src="${this.escapeHtml(data.imageUrl)}" alt="Generated: ${this.escapeHtml(trimmedPrompt)}" style="max-width: 100%; border-radius: 8px; margin-top: 8px;">
                        </div>
                        <div style="font-size: 12px; color: var(--color-text-muted); margin-top: 8px;">
                            Model: ${data.model} | Provider: ${data.provider}
                        </div>
                        <div class="message-actions" style="margin-top: 8px; display: flex; gap: 8px;">
                            <button class="message-action-btn" data-action="download-image" data-image-id="${this.escapeHtml(data.imageId || '')}" data-image-prompt="${this.escapeHtml(trimmedPrompt)}" title="Download">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                            </button>
                            <button class="message-action-btn" data-action="regenerate-image" data-image-prompt="${this.escapeHtml(trimmedPrompt)}" title="Regenerate">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36M20.49 15a9 9 0 0 1-14.85 3.36"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
                messagesList.appendChild(imageMessageEl);
                messagesList.parentElement.scrollTop = messagesList.parentElement.scrollHeight;

                // Update conversation in sidebar
                await this.loadConversations();
            }
        } catch (error) {
            console.error('Generate image error:', error);
            if (loadingEl.isConnected) {
                loadingEl.classList.remove('loading');
                loadingEl.innerHTML = `
                    <div class="message-content">
                        <div class="message-text" style="color: var(--color-error);">${this.escapeHtml(error.message || 'Connection error. Please check your internet and try again.')}</div>
                    </div>
                `;
            }
        }
    }

    async downloadImage(imageId, imageUrl, filename) {
        if (typeof imageId !== 'string' || !imageId) {
            return;
        }

        let downloadUrl;
        let extension;
        try {
            const response = await this.authenticatedFetch(
                `${this.apiBaseUrl}/images/${encodeURIComponent(imageId)}/download`
            );
            if (!response.ok) throw new Error('Image download request failed.');
            const blob = await response.blob();
            extension = {
                'image/jpeg': 'jpg',
                'image/png': 'png',
                'image/webp': 'webp'
            }[blob.type.toLowerCase()];
            if (!extension) throw new Error('Unsupported image format.');
            downloadUrl = URL.createObjectURL(blob);
        } catch {
            console.error('Image download failed.');
            return;
        }

        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${filename || 'generated-image'}.${extension}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    }

    async loadImageHistory() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/images/history`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });

            if (response.ok) {
                const data = await response.json();
                console.log('Image history:', data.images);
                return data.images || [];
            }
        } catch (error) {
            console.error('Load image history error:', error);
        }
        return [];
    }

    showImagePromptDialog() {
        const imagePrompt = window.prompt('Enter image description (max 1000 characters):', '');
        if (imagePrompt !== null) {
            this.generateImage(imagePrompt);
        }
    }

    regenerateImage(imagePrompt) {
        // Ask user if they want to use the same prompt or modify it
        const useOriginal = window.confirm(`Regenerate with original prompt?\n\n"${imagePrompt}"\n\nClick OK to regenerate, or Cancel to edit.`);

        if (useOriginal) {
            this.generateImage(imagePrompt);
        } else {
            const newPrompt = window.prompt('Enter new image description:', imagePrompt);
            if (newPrompt !== null && newPrompt.trim() !== '') {
                this.generateImage(newPrompt);
            }
        }
    }
}

// Initialize app
window.app = new EMOVA();
