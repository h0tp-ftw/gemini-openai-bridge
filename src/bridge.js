const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('cross-spawn');
const axios = require('axios');
const { formatChatCompletionChunk, formatChatCompletion, formatToolCallChunk } = require('./openai-utils');
const fileManager = require('./file-manager');

async function runGeminiBridge(messages, options, onChunk, onEnd, onError) {
    const {
        tools, tool_choice, use_native_tools = false,
        temperature, max_tokens, top_p, stop,
        sessionId: inputSessionId, sessionCount = 0,
        response_format, max_completion_tokens
    } = options;

    const cleanupQueue = [];
    const id = `chatcmpl-${Math.random().toString(36).substring(7)}`;

    // Helper to add transient files to cleanup queue
    const handleTransientFile = async (data, isBase64 = false) => {
        let extension = '';
        let buffer;

        if (isBase64) {
            const mimeMatch = data.match(/^data:([^;]+);base64,/);
            if (mimeMatch) {
                const mime = mimeMatch[1];
                const ext = mime.split('/').pop();
                extension = ext ? `.${ext}` : '';
            }
            const base64Data = data.replace(/^data:[^;]+;base64,/, "");
            buffer = Buffer.from(base64Data, 'base64');
        } else {
            const response = await axios.get(data, { responseType: 'arraybuffer' });
            buffer = Buffer.from(response.data);
            const urlExt = path.extname(new URL(data).pathname);
            extension = urlExt || '';
        }

        const tempPath = path.join(os.tmpdir(), `gemini-file-${id}-${Math.random().toString(36).substring(7)}${extension}`);
        fs.writeFileSync(tempPath, buffer);
        cleanupQueue.push(tempPath);
        return `@${tempPath}`;
    };

    let hasEmittedToolCall = false;

    // 1. Extract system and user/assistant messages
    const systemMessages = messages.filter(m => m.role === 'system');
    let systemPrompt = systemMessages.map(m => m.content).join('\n\n');

    // 2. Smart Resume: Slice messages to only include new ones if resuming
    let conversationMessages = messages;
    if (inputSessionId && sessionCount > 0 && messages.length > sessionCount) {
        conversationMessages = messages.slice(sessionCount);
    }

    // Filter out system messages from the conversation part (they are handled via env var)
    conversationMessages = conversationMessages.filter(m => m.role !== 'system');

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

    // JSON Mode Support
    if (response_format && response_format.type === 'json_object') {
        const jsonInstruction = `\nIMPORTANT: You MUST respond with a valid JSON object. Do not include any other text, markdown blocks, or explanations outside the JSON.`;
        systemPrompt = systemPrompt ? `${systemPrompt}${jsonInstruction}` : jsonInstruction.trim();
    }

    try {
        const fileAttachments = [];
        const conversationParts = await Promise.all(conversationMessages.map(async (m) => {
            let contentParts = [];
            if (Array.isArray(m.content)) {
                for (const c of m.content) {
                    if (c.type === 'text') contentParts.push(c.text);
                    else if (c.type === 'image_url' || c.type === 'file' || c.type === 'input_file') {
                        const url = (c.type === 'image_url')
                            ? (typeof c.image_url === 'string' ? c.image_url : c.image_url.url)
                            : (c.file?.url || c.input_file?.url || c.file?.data || c.input_file?.data);

                        if (!url && (c.file?.file_id || c.input_file?.file_id)) {
                            const fileId = c.file?.file_id || c.input_file?.file_id;
                            const localPath = fileManager.getFilePath(fileId);
                            if (localPath) {
                                fileAttachments.push(`@${localPath}`);
                                continue;
                            }
                        }

                        if (!url) continue;

                        // Check for persistent file-xxxx in URL
                        const fileIdMatch = url.match(/file-[a-f0-9]{16}/);
                        if (fileIdMatch) {
                            const localPath = fileManager.getFilePath(fileIdMatch[0]);
                            if (localPath) {
                                fileAttachments.push(`@${localPath}`);
                                continue;
                            }
                        }

                        // Check for base64 or remote URL
                        try {
                            if (url.startsWith('data:')) {
                                const path = await handleTransientFile(url, true);
                                fileAttachments.push(path);
                            } else if (url.startsWith('http')) {
                                const path = await handleTransientFile(url, false);
                                fileAttachments.push(path);
                            } else {
                                contentParts.push(`[File: ${url}]`);
                            }
                        } catch (err) {
                            console.error('Failed to handle vision image:', err.message);
                            contentParts.push(`[File Error: ${url}]`);
                        }
                    }
                }
            } else {
                let content = m.content || '';
                // Resolve file-xxxx IDs in string content
                const fileIdRegex = /file-[a-f0-9]{16}/g;
                content = content.replace(fileIdRegex, (id) => {
                    const localPath = fileManager.getFilePath(id);
                    if (localPath) {
                        fileAttachments.push(`@${localPath}`);
                        return '[File Attached]';
                    }
                    return id;
                });
                contentParts.push(content);
            }

            const content = contentParts.filter(Boolean).join('\n');
            if (m.role === 'tool') {
                return `Tool Result (id: ${m.tool_call_id}): ${content}`;
            }

            let assistantContent = content;
            if (m.role === 'assistant' && m.tool_calls && Array.isArray(m.tool_calls)) {
                const toolCallsStr = m.tool_calls.map(tc => {
                    return `TOOL_CALL: ${JSON.stringify({
                        id: tc.id,
                        name: tc.function?.name || tc.name,
                        arguments: tc.function?.arguments || tc.arguments
                    })}`;
                }).join('\n');
                assistantContent = assistantContent ? `${assistantContent}\n${toolCallsStr}` : toolCallsStr;
            }

            const role = m.role === 'user' ? 'User' : 'Assistant';
            return `${role}: ${assistantContent}`;
        }));

        // Deduplicate attachments
        const uniqueAttachments = [...new Set(fileAttachments)];
        const prompt = [...uniqueAttachments, ...conversationParts].join(' ');

        const model = options.model || 'gemini-cli-bridge';
        let fullResponse = '';
        let stats = null;
        let sessionId = inputSessionId || null;
        let isResumed = !!sessionId;
        let tempSystemFile = null;
        let tempSettingsFile = null;
        let toolCallBuffer = '';
        let isBufferingToolCall = false;
        const toolCalls = [];

        // 3. Prepare environment and arguments
        const env = { ...process.env, NO_COLOR: '1' };

        const args = [
            '-p', prompt,
            '--output-format', 'stream-json',
            '--yolo'
        ];

        if (sessionId) {
            args.push('--resume', sessionId);
        }

        // If explicitly requested JSON mode and we aren't streaming, we could use --output-format json
        // but stream-json is more robust for us as we have the parser loop already.
        // We'll stick to stream-json and rely on the system prompt injection.

        if (systemPrompt) {
            tempSystemFile = path.join(os.tmpdir(), `gemini-system-${id}.md`);
            try {
                fs.writeFileSync(tempSystemFile, systemPrompt);
                env.GEMINI_SYSTEM_MD = tempSystemFile;
                cleanupQueue.push(tempSystemFile);
            } catch (err) {
                console.error('Failed to create temp system file:', err);
            }
        }

        // Handle Robust Tool & Global Settings
        let settings = {};
        const baseSettingsPath = path.join(__dirname, '..', 'gemini-settings.json');
        if (fs.existsSync(baseSettingsPath)) {
            try {
                settings = JSON.parse(fs.readFileSync(baseSettingsPath, 'utf8'));
            } catch (err) {
                console.error('Failed to parse gemini-settings.json:', err);
            }
        }

        // Map selection to GEMINI_MODEL env var
        let selectedModel = options.model;
        if (!selectedModel || selectedModel === 'gemini-cli-bridge') {
            selectedModel = settings.model?.name || 'gemini-2.5-flash-lite';
        }

        if (selectedModel) {
            env.GEMINI_MODEL = selectedModel;
        }

        // Map generation parameters
        if (!settings.model) settings.model = {};
        if (!settings.model.modelConfig) settings.model.modelConfig = {};
        if (!settings.model.modelConfig.generateContentConfig) settings.model.modelConfig.generateContentConfig = {};

        const genConfig = settings.model.modelConfig.generateContentConfig;
        if (typeof temperature === 'number') genConfig.temperature = temperature;
        if (typeof top_p === 'number') genConfig.topP = top_p;

        const effectiveMaxTokens = max_tokens ?? max_completion_tokens;
        if (typeof effectiveMaxTokens === 'number') genConfig.maxOutputTokens = effectiveMaxTokens;

        if (stop) {
            genConfig.stopSequences = Array.isArray(stop) ? stop : [stop];
        }

        if (response_format && response_format.type === 'json_object') {
            genConfig.responseMimeType = "application/json";
        }

        if (!use_native_tools) {
            if (!settings.tools) settings.tools = {};
            if (!settings.tools.exclude) settings.tools.exclude = [];

            const nativeTools = [
                "run_shell_command", "google_web_search", "web_fetch", "browser",
                "canvas", "nodes", "cron", "message", "gateway", "agents_list",
                "sessions_list", "sessions_history", "sessions_send", "sessions_spawn",
                "subagents", "session_status", "image"
            ];

            nativeTools.forEach(t => {
                if (!settings.tools.exclude.includes(t)) {
                    settings.tools.exclude.push(t);
                }
            });
        }

        if (tempSettingsFile || !use_native_tools || Object.keys(settings).length > 0) {
            tempSettingsFile = path.join(os.tmpdir(), `gemini-settings-${id}.json`);
            try {
                fs.writeFileSync(tempSettingsFile, JSON.stringify(settings, null, 2));
                env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = tempSettingsFile;
                console.log(`Gemini CLI settings applied via: ${tempSettingsFile}`);
            } catch (err) {
                console.error('Failed to create temp settings file:', err);
            }
        }

        const voltaPath = path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'gemini.cmd');
        const geminiPath = process.env.GEMINI_CLI_PATH || (fs.existsSync(voltaPath) ? voltaPath : 'gemini');
        console.log(`Spawning Gemini CLI via path: ${geminiPath}`);
        console.log(`Model: ${env.GEMINI_MODEL || 'default'}`);

        const child = spawn(geminiPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
            shell: false
        });

        // Request Timeout (2 minutes default)
        const TIMEOUT_MS = parseInt(process.env.BRIDGE_TIMEOUT_MS) || 120000;
        const timeout = setTimeout(() => {
            console.error(`Request timed out after ${TIMEOUT_MS / 1000}s. Killing process ${child.pid}`);
            child.kill();
            onError(new Error(`Gemini CLI request timed out after ${TIMEOUT_MS / 1000}s`));
        }, TIMEOUT_MS);

        const readline = require('readline');
        const rl = readline.createInterface({
            input: child.stdout,
            terminal: false
        });

        rl.on('line', (line) => {
            if (!line.trim()) return;
            try {
                const json = JSON.parse(line);
                if (json.type === 'init' && json.session_id) {
                    sessionId = json.session_id;
                }

                if (json.type === 'message' && json.role === 'assistant' && json.content) {
                    const content = json.content;

                    if (isBufferingToolCall) {
                        toolCallBuffer += content;
                        // Check if the JSON block is potentially closed
                        if (toolCallBuffer.trim().endsWith('}')) {
                            try {
                                const toolCall = JSON.parse(toolCallBuffer);
                                onChunk(formatToolCallChunk(id, model, toolCall, toolCalls.length));
                                isBufferingToolCall = false;
                                toolCallBuffer = '';
                                hasEmittedToolCall = true;
                                toolCalls.push(toolCall);
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
                                onChunk(formatToolCallChunk(id, model, toolCall, toolCalls.length));
                                isBufferingToolCall = false;
                                toolCallBuffer = '';
                                hasEmittedToolCall = true;
                                toolCalls.push(toolCall);
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
                // Not JSON - might be raw text from Gemini (thoughts, plans, etc.)
                if (line.includes('TOOL_CALL:') || isBufferingToolCall) {
                    // Mirror the logic from above but for 'line' instead of 'content'
                    const content = line;
                    if (isBufferingToolCall) {
                        toolCallBuffer += content;
                        if (toolCallBuffer.trim().endsWith('}')) {
                            try {
                                const toolCall = JSON.parse(toolCallBuffer);
                                onChunk(formatToolCallChunk(id, model, toolCall, toolCalls.length));
                                isBufferingToolCall = false;
                                toolCallBuffer = '';
                                hasEmittedToolCall = true;
                                toolCalls.push(toolCall);
                            } catch (e) { }
                        }
                    } else if (content.includes('TOOL_CALL:')) {
                        const parts = content.split('TOOL_CALL:');
                        if (parts[0].trim()) {
                            fullResponse += parts[0];
                            onChunk(formatChatCompletionChunk(id, model, parts[0]));
                        }
                        isBufferingToolCall = true;
                        toolCallBuffer = parts[1].trim();
                        if (toolCallBuffer.endsWith('}')) {
                            try {
                                const toolCall = JSON.parse(toolCallBuffer);
                                onChunk(formatToolCallChunk(id, model, toolCall, toolCalls.length));
                                isBufferingToolCall = false;
                                toolCallBuffer = '';
                                hasEmittedToolCall = true;
                                toolCalls.push(toolCall);
                            } catch (e) { }
                        }
                    }
                } else {
                    // Treat raw text as content
                    const text = line + '\n';
                    fullResponse += text;
                    onChunk(formatChatCompletionChunk(id, model, text));
                }
            }
        });

        child.stderr.on('data', (data) => {
            const msg = data.toString();
            process.stderr.write(`Gemini CLI Error: ${msg}\n`);
            // Capture boot errors
            if (msg.includes('command not found') || msg.includes('is not recognized')) {
                onError(new Error(`Gemini CLI command failed: ${msg.trim()}`));
                child.kill();
            }
        });

        child.on('error', (err) => {
            onError(new Error(`Failed to start Gemini CLI: ${err.message}`));
        });

        let isRlClosed = false;
        let isChildClosed = false;
        let exitCode = null;

        const maybeEnd = () => {
            if (isRlClosed && isChildClosed) {
                // Cleanup all temporary files in the queue
                cleanupQueue.forEach(f => {
                    if (f && fs.existsSync(f)) {
                        try {
                            fs.unlinkSync(f);
                        } catch (err) { }
                    }
                });

                if (exitCode !== 0 && exitCode !== null) {
                    onError(new Error(`Gemini CLI exited with code ${exitCode}. Check if it is installed and authenticated.`));
                } else if (fullResponse || stats || hasEmittedToolCall) {
                    // Post-process JSON mode to strip markdown blocks if present
                    if (response_format && response_format.type === 'json_object' && fullResponse) {
                        fullResponse = fullResponse.trim();
                        if (fullResponse.startsWith('```')) {
                            fullResponse = fullResponse.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
                        }
                    }
                    onEnd(id, model, fullResponse, stats, hasEmittedToolCall, toolCalls, sessionId);
                } else {
                    onEnd(id, model, "", null, false, [], sessionId);
                }
            }
        };

        rl.on('close', () => {
            isRlClosed = true;
            maybeEnd();
        });

        child.on('close', (code) => {
            clearTimeout(timeout);
            isChildClosed = true;
            exitCode = code;
            maybeEnd();
        });

        return child;
    } catch (err) {
        // Ensure cleanup even on prep errors
        cleanupQueue.forEach(f => {
            if (f && fs.existsSync(f)) {
                try { fs.unlinkSync(f); } catch (e) { }
            }
        });
        onError(err);
    }
}

module.exports = { runGeminiBridge };
