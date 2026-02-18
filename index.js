require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const { runGeminiBridge } = require('./src/bridge');
const { formatChatCompletionChunk, formatChatCompletion } = require('./src/openai-utils');

fastify.register(cors, { origin: '*' });

fastify.post('/v1/chat/completions', async (request, reply) => {
    const { messages, stream, model } = request.body;

    if (!messages || !Array.isArray(messages)) {
        return reply.status(400).send({ error: 'Invalid messages' });
    }

    if (stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        runGeminiBridge(
            messages,
            { model },
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
                reply.raw.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
                reply.raw.end();
            }
        );

        // Fastify will handle the raw reply
        return reply;
    } else {
        return new Promise((resolve, reject) => {
            runGeminiBridge(
                messages,
                { model },
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
