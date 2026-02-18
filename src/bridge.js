const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('cross-spawn');
const { formatChatCompletionChunk, formatChatCompletion } = require('./openai-utils');

function runGeminiBridge(messages, options, onChunk, onEnd, onError) {
    // 1. Extract system and user/assistant messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const systemPrompt = systemMessages.map(m => m.content).join('\n\n');
    const prompt = conversationMessages
        .map(m => {
            const role = m.role === 'user' ? 'User' : 'Assistant';
            return `${role}: ${m.content}`;
        })
        .join('\n\n');

    const id = `chatcmpl-${Math.random().toString(36).substring(7)}`;
    const model = options.model || 'gemini-cli-bridge';
    let fullResponse = '';
    let stats = null;
    let tempSystemFile = null;

    // 2. Prepare environment and arguments
    const env = { ...process.env, NO_COLOR: '1' };
    const args = [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--yolo'
    ];

    if (systemPrompt) {
        tempSystemFile = path.join(os.tmpdir(), `gemini-system-${id}.md`);
        try {
            fs.writeFileSync(tempSystemFile, systemPrompt);
            env.GEMINI_SYSTEM_MD = tempSystemFile;
            console.log(`System prompt applied via: ${tempSystemFile}`);
        } catch (err) {
            console.error('Failed to create temp system file:', err);
        }
    }

    const geminiPath = 'C:\\Users\\h0tp\\AppData\\Local\\Volta\\bin\\gemini.cmd';
    console.log(`Spawning ${geminiPath} with prompt: ${prompt.substring(0, 50)}...`);

    const child = spawn(geminiPath, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        env
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
                } else if (json.type === 'result' && json.stats) {
                    stats = json.stats;
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
        // 3. Cleanup temp file
        if (tempSystemFile && fs.existsSync(tempSystemFile)) {
            try {
                fs.unlinkSync(tempSystemFile);
                console.log(`Cleaned up temp system file: ${tempSystemFile}`);
            } catch (err) {
                console.error('Failed to delete temp system file:', err);
            }
        }

        if (code !== 0) {
            onError(new Error(`Gemini CLI exited with code ${code}`));
        } else {
            onEnd(id, model, fullResponse, stats);
        }
    });

    return child;
}

module.exports = { runGeminiBridge };
