require('dotenv').config();
const fastify = require('fastify')({
    logger: true,
    bodyLimit: 52428800 // 50MB
});
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');
const { runGeminiBridge } = require('./src/bridge');
const { formatChatCompletionChunk, formatChatCompletion, formatModelsList, formatResponse } = require('./src/openai-utils');
const fileManager = require('./src/file-manager');
const sessionStore = require('./src/session-store');

fastify.register(cors, { origin: '*' });
fastify.register(multipart);
fastify.register(require('@fastify/static'), {
    root: require('path').join(__dirname, 'uploads'),
    prefix: '/uploads/', // Not used directly but required by static
    serve: false // We use reply.sendFile manually
});

fastify.addHook('preHandler', (request, reply, done) => {
    // API key validation (skip if no key configured)
    const configuredKey = process.env.BRIDGE_API_KEY;
    if (configuredKey) {
        const authHeader = request.headers.authorization;
        const providedKey = authHeader?.replace('Bearer ', '');
        if (providedKey !== configuredKey) {
            return reply.status(401).send({
                error: { message: 'Invalid API key', type: 'invalid_api_key', code: 'invalid_api_key' }
            });
        }
    }

    request.log.info({
        method: request.method,
        url: request.url,
        body: request.body,
        headers: request.headers
    }, 'INCOMING REQUEST DUMP');
    done();
});

// Helper to find session via ID or History Hashing
function getEffectiveSession(messages, conversation_id) {
    if (conversation_id) {
        const sessionInfo = sessionStore.get(conversation_id);
        if (sessionInfo) return { sessionId: sessionInfo.sessionId, sessionCount: sessionInfo.count };
    }
    // Auto-detect based on history hash
    if (messages && messages.length > 1) {
        const historyHash = sessionStore.createHash(messages.slice(0, -1));
        const autoSession = sessionStore.findAutoSession(historyHash);
        if (autoSession) return { sessionId: autoSession.sessionId, sessionCount: autoSession.count };
    }
    return { sessionId: null, sessionCount: 0 };
}

// Helper to save session state
function saveEffectiveSession(messages, conversation_id, finalSessionId, fullResponse, toolCalls) {
    if (!finalSessionId) return;
    const count = messages.length + 1;

    if (conversation_id) {
        sessionStore.set(conversation_id, finalSessionId, count);
    }

    // Always save auto-session for standard OpenAI clients
    const assistantMsg = { role: 'assistant', content: fullResponse };
    if (toolCalls && toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;

    const fullHistory = [...messages, assistantMsg];
    const hash = sessionStore.createHash(fullHistory);
    sessionStore.saveAutoSession(hash, finalSessionId, count);
}

fastify.get('/v1/models', async (request, reply) => {
    return JSON.parse(formatModelsList());
});

fastify.get('/v1/files', async (request, reply) => {
    return { object: 'list', data: fileManager.listFiles() };
});

fastify.get('/v1/files/:id', async (request, reply) => {
    const { id } = request.params;
    const metadata = fileManager.getMetadata();
    const file = metadata.files[id];

    if (!file) {
        return reply.status(404).send({ error: { message: 'File not found', type: 'invalid_request_error', param: 'id', code: null } });
    }

    const { local_path, ...openaiFile } = file;
    return openaiFile;
});

fastify.get('/v1/files/:id/content', async (request, reply) => {
    const { id } = request.params;
    const localPath = fileManager.getFilePath(id);

    if (!localPath || !require('fs').existsSync(localPath)) {
        return reply.status(404).send({ error: { message: 'File not found', type: 'invalid_request_error', param: 'id', code: null } });
    }

    return reply.sendFile(require('path').basename(localPath), require('path').dirname(localPath));
});

fastify.delete('/v1/files/:id', async (request, reply) => {
    const { id } = request.params;
    const deleted = fileManager.deleteFile(id);

    if (!deleted) {
        return reply.status(404).send({ error: { message: 'File not found', type: 'invalid_request_error', param: 'id', code: null } });
    }

    return { id, object: 'file', deleted: true };
});

fastify.post('/v1/files', async (request, reply) => {
    const data = await request.file();
    if (!data) {
        return reply.status(400).send({ error: { message: 'No file uploaded', type: 'invalid_request_error', param: null, code: null } });
    }

    const buffer = await data.toBuffer();
    const fileObj = await fileManager.saveFile(buffer, data.filename, data.fields.purpose?.value || 'user_data');

    // Remote local_path from response to match OpenAI
    const { local_path, ...openaiFile } = fileObj;
    return openaiFile;
});

fastify.post('/v1/chat/completions', async (request, reply) => {
    const {
        messages, stream, model, tools, tool_choice, use_native_tools,
        temperature, max_tokens, top_p, stop,
        conversation_id, response_format, max_completion_tokens
    } = request.body;

    if (!messages || !Array.isArray(messages)) {
        return reply.status(400).send({ error: { message: 'Invalid messages', type: 'invalid_request_error', param: 'messages', code: null } });
    }

    const { sessionId, sessionCount } = getEffectiveSession(messages, conversation_id);

    if (stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        let isFirstChunk = true;
        runGeminiBridge(
            messages,
            { model, tools, tool_choice, use_native_tools, temperature, max_tokens, top_p, stop, sessionId, response_format, max_completion_tokens, sessionCount },
            (chunk) => {
                let jsonChunk;
                try {
                    jsonChunk = JSON.parse(chunk);
                    if (isFirstChunk) {
                        jsonChunk.choices[0].delta.role = 'assistant';
                        chunk = JSON.stringify(jsonChunk);
                        isFirstChunk = false;
                    }
                } catch (e) { }
                reply.raw.write(`data: ${chunk}\n\n`);
            },
            (id, modelName, fullResponse, stats, hasToolCall, toolCalls, finalSessionId) => {
                saveEffectiveSession(messages, conversation_id, finalSessionId, fullResponse, toolCalls);

                if (stats) {
                    const usageChunk = {
                        id,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: modelName,
                        choices: [],
                        usage: {
                            prompt_tokens: stats.input_tokens,
                            completion_tokens: stats.output_tokens,
                            total_tokens: stats.total_tokens
                        }
                    };
                    if (stats.cached > 0) {
                        usageChunk.usage.prompt_tokens_details = {
                            cached_tokens: stats.cached
                        };
                    }
                    reply.raw.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
                }
                const finishReason = hasToolCall ? 'tool_calls' : 'stop';
                reply.raw.write(`data: ${formatChatCompletionChunk(id, modelName, null, finishReason)}\n\n`);
                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
            },
            (error) => {
                fastify.log.error(error);
                reply.raw.write(`data: ${JSON.stringify({ error: { message: error.message, type: 'api_error', param: null, code: null } })}\n\n`);
                reply.raw.end();
            }
        );

        return reply;
    } else {
        return new Promise((resolve, reject) => {
            runGeminiBridge(
                messages,
                { model, tools, tool_choice, use_native_tools, temperature, max_tokens, top_p, stop, sessionId, response_format, max_completion_tokens, sessionCount },
                (chunk) => { },
                (id, modelName, response, stats, hasToolCall, toolCalls, finalSessionId) => {
                    saveEffectiveSession(messages, conversation_id, finalSessionId, response, toolCalls);

                    let usage = null;
                    if (stats) {
                        usage = {
                            prompt_tokens: stats.input_tokens,
                            completion_tokens: stats.output_tokens,
                            total_tokens: stats.total_tokens
                        };
                        if (stats.cached > 0) {
                            usage.prompt_tokens_details = {
                                cached_tokens: stats.cached
                            };
                        }
                    }
                    resolve(JSON.parse(formatChatCompletion(id, modelName, response, usage, toolCalls)));
                },
                (error) => {
                    reject(error);
                }
            );
        });
    }
});

fastify.post('/v1/responses', async (request, reply) => {
    const {
        messages, input, stream, model, tools, tool_choice,
        temperature, max_tokens, top_p, stop,
        conversation_id, response_format, max_completion_tokens
    } = request.body;

    // Normalize input to messages
    let normalizedMessages = messages;
    if (!normalizedMessages && input) {
        normalizedMessages = (Array.isArray(input) ? input : [input]).map(item => {
            if (typeof item === 'string') return { role: 'user', content: item };
            if (item.type === 'input_text') return { role: 'user', content: item.text };
            return { role: 'user', content: JSON.stringify(item) }; // Fallback
        });
    }

    if (!normalizedMessages || !Array.isArray(normalizedMessages)) {
        return reply.status(400).send({ error: { message: 'Invalid messages or input', type: 'invalid_request_error', param: 'input', code: null } });
    }

    const { sessionId, sessionCount } = getEffectiveSession(normalizedMessages, conversation_id);

    if (stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        runGeminiBridge(
            normalizedMessages,
            { model, tools, tool_choice, temperature, max_tokens, top_p, stop, sessionId, response_format, max_completion_tokens, sessionCount },
            (chunk) => {
                reply.raw.write(`data: ${chunk}\n\n`);
            },
            (id, modelName, fullResponse, stats, hasToolCall, toolCalls, finalSessionId) => {
                saveEffectiveSession(normalizedMessages, conversation_id, finalSessionId, fullResponse, toolCalls);
                const finishReason = hasToolCall ? 'tool_calls' : 'stop';
                reply.raw.write(`data: ${formatChatCompletionChunk(id, modelName, null, finishReason)}\n\n`);
                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
            },
            (error) => {
                fastify.log.error(error);
                reply.raw.write(`data: ${JSON.stringify({ error: { message: error.message, type: 'api_error', param: null, code: null } })}\n\n`);
                reply.raw.end();
            }
        );

        return reply;
    } else {
        return new Promise((resolve, reject) => {
            runGeminiBridge(
                normalizedMessages,
                { model, tools, tool_choice, temperature, max_tokens, top_p, stop, sessionId, response_format, max_completion_tokens, sessionCount },
                (chunk) => { },
                (id, modelName, response, stats, hasToolCall, toolCalls, finalSessionId) => {
                    saveEffectiveSession(normalizedMessages, conversation_id, finalSessionId, response, toolCalls);
                    let usage = null;
                    if (stats) {
                        usage = {
                            prompt_tokens: stats.input_tokens,
                            completion_tokens: stats.output_tokens,
                            total_tokens: stats.total_tokens
                        };
                    }
                    const responseObj = JSON.parse(formatResponse(id, modelName, response, usage));
                    resolve(responseObj);
                },
                (error) => {
                    reject(error);
                }
            );
        });
    }
});

const start = async () => {
    try {
        const port = process.env.PORT || 3000;
        await fastify.listen({ port: parseInt(port), host: '0.0.0.0' });
        console.log(`Gemini CLI OpenAI Bridge listening on port ${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
