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
            (id, modelName, fullResponse) => {
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
            let fullResponse = '';
            let completionId = '';
            let completionModel = '';

            runGeminiBridge(
                messages,
                { model },
                (chunk) => {
                    // Ignore chunks in non-streaming mode, we collect the full response
                },
                (id, modelName, response) => {
                    resolve(JSON.parse(formatChatCompletion(id, modelName, response)));
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
