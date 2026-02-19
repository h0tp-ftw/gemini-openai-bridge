const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SessionStore {
    constructor() {
        this.filePath = path.join(__dirname, '..', 'sessions.json');
        this.sessions = {};
        this.autoSessions = {}; // Maps message history hash -> { sessionId, count }
        this.load();
    }

    load() {
        if (fs.existsSync(this.filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
                this.sessions = data.sessions || {};
                this.autoSessions = data.autoSessions || {};

                // Migration check: if old format (direct map), move to sessions
                if (!data.sessions && !data.autoSessions && Object.keys(data).length > 0) {
                    this.sessions = data;
                }
            } catch (e) {
                console.error('Failed to load sessions.json:', e);
                this.sessions = {};
                this.autoSessions = {};
            }
        }
    }

    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify({
                sessions: this.sessions,
                autoSessions: this.autoSessions
            }, null, 2));
        } catch (e) {
            console.error('Failed to save sessions.json:', e);
        }
    }

    get(conversationId) {
        const data = this.sessions[conversationId];
        if (typeof data === 'string') return { sessionId: data, count: 0 };
        return data || null;
    }

    set(conversationId, sessionId, count = 0) {
        this.sessions[conversationId] = { sessionId, count };
        this.save();
    }

    // --- Automatic Session Detection Helpers ---

    createHash(messages) {
        // We hash the message history (excluding the very last User message if it's a resume)
        // For consistency, we stringify the array
        const str = JSON.stringify(messages);
        return crypto.createHash('sha256').update(str).digest('hex');
    }

    findAutoSession(hash) {
        return this.autoSessions[hash] || null;
    }

    saveAutoSession(hash, sessionId, count) {
        // Limit auto-sessions to prevent unbounded file growth
        const keys = Object.keys(this.autoSessions);
        if (keys.length > 500) {
            delete this.autoSessions[keys[0]]; // Simple FIFO cleanup
        }

        this.autoSessions[hash] = { sessionId, count };
        this.save();
    }

    delete(conversationId) {
        delete this.sessions[conversationId];
        this.save();
    }
}

module.exports = new SessionStore();
