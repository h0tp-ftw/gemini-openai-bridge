const fs = require('fs');
const path = require('path');

function formatChatCompletionChunk(id, model, content, finishReason = null) {
    return JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                delta: content ? { content } : {},
                finish_reason: finishReason
            }
        ]
    });
}

function formatChatCompletion(id, model, content, usage = null) {
    return JSON.stringify({
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: content
                },
                finish_reason: 'stop'
            }
        ],
        usage: usage || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
    });
}

function formatToolCallChunk(id, model, toolCall) {
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
                            index: 0,
                            id: toolCall.id,
                            type: 'function',
                            function: {
                                name: toolCall.name,
                                arguments: toolCall.arguments
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
    try {
        const settingsPath = path.join(__dirname, '..', 'gemini-settings.json');
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            previewEnabled = settings.general?.previewFeatures === true;
        }
    } catch (e) { }

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

module.exports = {
    formatChatCompletionChunk,
    formatChatCompletion,
    formatToolCallChunk,
    formatModelsList
};
