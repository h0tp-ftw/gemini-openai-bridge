const fs = require('fs');
const path = require('path');

function formatChatCompletionChunk(id, model, content, finishReason = null, role = null) {
    const delta = {};
    if (role) delta.role = role;
    if (content) delta.content = content;

    return JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                delta,
                finish_reason: finishReason
            }
        ]
    });
}

function formatChatCompletion(id, model, content, usage = null, toolCalls = null) {
    const message = {
        role: 'assistant',
        content: content || null
    };

    if (toolCalls && toolCalls.length > 0) {
        message.tool_calls = toolCalls.map((tc, idx) => ({
            id: tc.id || `call_${Math.random().toString(36).substring(7)}`,
            type: 'function',
            function: {
                name: tc.name,
                arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
            }
        }));
    }

    return JSON.stringify({
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                message: message,
                finish_reason: (toolCalls && toolCalls.length > 0) ? 'tool_calls' : 'stop'
            }
        ],
        usage: usage || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
    });
}

function formatToolCallChunk(id, model, toolCall, index = 0) {
    const args = typeof toolCall.arguments === 'string' ? toolCall.arguments : JSON.stringify(toolCall.arguments);

    return JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                delta: {
                    tool_calls: [
                        {
                            index,
                            id: toolCall.id,
                            type: 'function',
                            function: {
                                name: toolCall.name,
                                arguments: args
                            }
                        }
                    ]
                },
                finish_reason: null
            }
        ]
    });
}

function formatModelsList() {
    let previewEnabled = false;
    let customModels = [];
    try {
        const settingsPath = path.join(__dirname, '..', 'gemini-settings.json');
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            previewEnabled = settings.general?.previewFeatures === true;
            if (Array.isArray(settings.models)) {
                customModels = settings.models.map(m => ({
                    id: m.id,
                    object: 'model',
                    created: m.created || 1740000000,
                    owned_by: m.owned_by || 'google'
                }));
            }
        }
    } catch (e) { }

    if (customModels.length > 0) {
        return JSON.stringify({ object: 'list', data: customModels });
    }

    const models = [
        { id: 'auto-gemini-2.5', object: 'model', created: 1740000000, owned_by: 'google' },
        { id: 'gemini-2.5-pro', object: 'model', created: 1740000000, owned_by: 'google' },
        { id: 'gemini-2.5-flash', object: 'model', created: 1740000000, owned_by: 'google' },
        { id: 'gemini-2.5-flash-lite', object: 'model', created: 1740000000, owned_by: 'google' }
    ];

    if (previewEnabled) {
        models.unshift(
            { id: 'auto-gemini-3', object: 'model', created: 1740000000, owned_by: 'google' },
            { id: 'gemini-3-pro-preview', object: 'model', created: 1740000000, owned_by: 'google' },
            { id: 'gemini-3-flash-preview', object: 'model', created: 1740000000, owned_by: 'google' }
        );
    }

    return JSON.stringify({ object: 'list', data: models });
}

function formatResponse(id, model, content, usage = null) {
    return JSON.stringify({
        id,
        object: 'response',
        status: 'completed',
        created: Math.floor(Date.now() / 1000),
        model,
        output: [
            {
                type: 'message',
                role: 'assistant',
                content: [
                    {
                        type: 'output_text',
                        text: content
                    }
                ]
            }
        ],
        usage: usage || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
    });
}

module.exports = {
    formatChatCompletionChunk,
    formatChatCompletion,
    formatToolCallChunk,
    formatModelsList,
    formatResponse
};
