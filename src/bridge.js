const { spawn } = require('cross-spawn');
const { formatChatCompletionChunk, formatChatCompletion } = require('./openai-utils');

function runGeminiBridge(messages, options, onChunk, onEnd, onError) {
    const prompt = messages
        .map(m => {
            const role = m.role === 'system' ? 'Instructions' : m.role === 'user' ? 'User' : 'Assistant';
            return `${role}: ${m.content}`;
        })
        .join('\n\n');

    const id = `chatcmpl-${Math.random().toString(36).substring(7)}`;
    const model = options.model || 'gemini-cli-bridge';
    let fullResponse = '';

    const args = [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--yolo'
    ];

    const geminiPath = 'C:\\Users\\h0tp\\AppData\\Local\\Volta\\bin\\gemini.cmd';
    console.log(`Spawning ${geminiPath} with prompt: ${prompt.substring(0, 50)}...`);

    const child = spawn(geminiPath, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' }
    });

    child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const json = JSON.parse(line);
                if (json.type === 'message' && json.role === 'assistant' && json.content) {
                    fullResponse += json.content;
                    onChunk(formatChatCompletionChunk(id, model, json.content));
                } else if (json.type === 'result') {
                    // Handle stats if needed
                }
            } catch (e) {
                // Not JSON or partial JSON
            }
        }
    });

    child.stderr.on('data', (data) => {
        const msg = data.toString();
        console.error(`Gemini CLI Error: ${msg}`);
    });

    child.on('close', (code) => {
        if (code !== 0) {
            onError(new Error(`Gemini CLI exited with code ${code}`));
        } else {
            onEnd(id, model, fullResponse);
        }
    });

    return child;
}

module.exports = { runGeminiBridge };
