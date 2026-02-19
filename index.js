require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');
const { runGeminiBridge } = require('./src/bridge');
const { formatChatCompletionChunk, formatChatCompletion, formatModelsList, formatResponse } = require('./src/openai-utils');
const fileManager = require('./src/file-manager');

fastify.register(cors, { origin: '*' });
fastify.register(multipart);

fastify.addHook('preHandler', (request, reply, done) => {
    request.log.info({
        method: request.method,
        url: request.url,
        body: request.body,
        headers: request.headers
    }, 'INCOMING REQUEST DUMP');
    done();
});

fastify.get('/v1/models', async (request, reply) => {
    return JSON.parse(formatModelsList());
});

fastify.get('/v1/files', async (request, reply) => {
    return { object: 'list', data: fileManager.listFiles() };
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
        temperature, max_tokens, top_p, stop
    } = request.body;

    if (!messages || !Array.isArray(messages)) {
        return reply.status(400).send({ error: { message: 'Invalid messages', type: 'invalid_request_error', param: 'messages', code: null } });
    }

    if (stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        runGeminiBridge(
            messages,
            { model, tools, tool_choice, use_native_tools, temperature, max_tokens, top_p, stop },
            (chunk) => {
                reply.raw.write(`data: ${chunk}\n\n`);
            },
            (id, modelName, fullResponse, stats) => {
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
                reply.raw.write(`data: ${formatChatCompletionChunk(id, modelName, null, 'stop')}\n\n`);
                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
            },
            (error) => {
                fastify.log.error(error);
                reply.raw.write(`data: ${JSON.stringify({ error: { message: error.message, type: 'api_error', param: null, code: null } })}\n\n`);
                reply.raw.end();
            }
        );

        // Fastify will handle the raw reply
        return reply;
    } else {
        return new Promise((resolve, reject) => {
            runGeminiBridge(
                messages,
                { model, tools, tool_choice, use_native_tools, temperature, max_tokens, top_p, stop },
                (chunk) => {
                    // Ignore chunks in non-streaming mode
                },
                (id, modelName, response, stats) => {
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
                    resolve(JSON.parse(formatChatCompletion(id, modelName, response, usage)));
                },
                (error) => {
                    reject(error);
                }
            );
        });
    }
});

fastify.post('/v1/responses', async (request, reply) => {
    // The Responses API uses 'input' as an array of items, or 'messages'
    const {
        messages, input, stream, model, tools, tool_choice,
        temperature, max_tokens, top_p, stop
    } = request.body;

    // Normalize input to messages for the bridge
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

    if (stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        runGeminiBridge(
            normalizedMessages,
            { model, tools, tool_choice, temperature, max_tokens, top_p, stop },
            (chunk) => {
                reply.raw.write(`data: ${chunk}\n\n`);
            },
            (id, modelName, fullResponse, stats) => {
                // Responses API matches chat completion chunk format for SSE mostly
                reply.raw.write(`data: ${formatChatCompletionChunk(id, modelName, null, 'stop')}\n\n`);
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
                { model, tools, tool_choice, temperature, max_tokens, top_p, stop },
                (chunk) => { },
                (id, modelName, response, stats) => {
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
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
        console.log('Gemini CLI OpenAI Bridge listening on port 3000');
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
