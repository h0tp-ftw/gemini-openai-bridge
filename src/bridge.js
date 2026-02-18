const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('cross-spawn');
const { formatChatCompletionChunk, formatChatCompletion, formatToolCallChunk } = require('./openai-utils');

function runGeminiBridge(messages, options, onChunk, onEnd, onError) {
    const { tools, tool_choice, use_native_tools = false } = options;

    // 1. Extract system and user/assistant messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    let systemPrompt = systemMessages.map(m => m.content).join('\n\n');

    // 2. Inject External Tools and Protocol if provided
    if (tools && tools.length > 0) {
        const toolDefs = tools.map(t => {
            return `- ${t.function.name}: ${t.function.description}. Parameters: ${JSON.stringify(t.function.parameters)}`;
        }).join('\n');

        const toolProtocol = `
## Available Tools
You have access to the following external tools. If you need to use them, output ONLY a JSON block in this format: 
TOOL_CALL: {"id": "unique_id", "name": "function_name", "arguments": "{\\"arg1\\": \\"val\\"}"}

Tools:
${toolDefs}

${use_native_tools ? '' : 'IMPORTANT: Use ONLY the tools listed above. Do NOT use your native tools like Bash or Google Search.'}
`;
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${toolProtocol}` : toolProtocol;
    }

    const prompt = conversationMessages
        .map(m => {
            if (m.role === 'tool') {
                return `Tool Result (id: ${m.tool_call_id}): ${m.content}`;
            }
            const role = m.role === 'user' ? 'User' : 'Assistant';
            return `${role}: ${m.content}`;
        })
        .join('\n\n');

    const id = `chatcmpl-${Math.random().toString(36).substring(7)}`;
    const model = options.model || 'gemini-cli-bridge';
    let fullResponse = '';
    let stats = null;
    let tempSystemFile = null;
    let tempSettingsFile = null;
    let toolCallBuffer = '';
    let isBufferingToolCall = false;

    // 3. Prepare environment and arguments
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

    // Handle Robust Tool Blocking
    if (!use_native_tools) {
        tempSettingsFile = path.join(os.tmpdir(), `gemini-settings-${id}.json`);
        const settings = {
            tools: {
                exclude: [
                    "run_shell_command",
                    "google_web_search",
                    "web_fetch",
                    "browser",
                    "canvas",
                    "nodes",
                    "cron",
                    "message",
                    "gateway",
                    "agents_list",
                    "sessions_list",
                    "sessions_history",
                    "sessions_send",
                    "sessions_spawn",
                    "subagents",
                    "session_status",
                    "image"
                ]
            }
        };
        try {
            fs.writeFileSync(tempSettingsFile, JSON.stringify(settings));
            env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = tempSettingsFile;
            console.log(`Native tools blocked via: ${tempSettingsFile}`);
        } catch (err) {
            console.error('Failed to create temp settings file:', err);
        }
    }

    const geminiPath = 'C:\\Users\\h0tp\\AppData\\Local\\Volta\\bin\\gemini.cmd';
    console.log(`Spawning ${geminiPath}...`);

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
                    const content = json.content;

                    if (isBufferingToolCall) {
                        toolCallBuffer += content;
                        // Check if the JSON block is potentially closed
                        if (toolCallBuffer.trim().endsWith('}')) {
                            try {
                                const toolCall = JSON.parse(toolCallBuffer);
                                onChunk(formatToolCallChunk(id, model, toolCall));
                                isBufferingToolCall = false;
                                toolCallBuffer = '';
                            } catch (e) {
                                // Still not complete or invalid JSON, keep buffering
                            }
                        }
                    } else if (content.includes('TOOL_CALL:')) {
                        const parts = content.split('TOOL_CALL:');
                        // Content before TOOL_CALL is normal text
                        if (parts[0].trim()) {
                            fullResponse += parts[0];
                            onChunk(formatChatCompletionChunk(id, model, parts[0]));
                        }

                        isBufferingToolCall = true;
                        toolCallBuffer = parts[1].trim();

                        // Check if it's already complete in one chunk
                        if (toolCallBuffer.endsWith('}')) {
                            try {
                                const toolCall = JSON.parse(toolCallBuffer);
                                onChunk(formatToolCallChunk(id, model, toolCall));
                                isBufferingToolCall = false;
                                toolCallBuffer = '';
                            } catch (e) { }
                        }
                    } else {
                        fullResponse += content;
                        onChunk(formatChatCompletionChunk(id, model, content));
                    }
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
        process.stderr.write(`Gemini CLI Error: ${msg}\n`);
    });

    child.on('close', (code) => {
        // Cleanup temp files
        const filesToCleanup = [tempSystemFile, tempSettingsFile];
        filesToCleanup.forEach(f => {
            if (f && fs.existsSync(f)) {
                try {
                    fs.unlinkSync(f);
                } catch (err) { }
            }
        });

        if (code !== 0) {
            onError(new Error(`Gemini CLI exited with code ${code}`));
        } else {
            onEnd(id, model, fullResponse, stats);
        }
    });

    return child;
}

module.exports = { runGeminiBridge };
