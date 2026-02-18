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

module.exports = {
    formatChatCompletionChunk,
    formatChatCompletion,
    formatToolCallChunk
};
