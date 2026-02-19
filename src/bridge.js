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
        temperature, max_tokens, top_p, stop
    } = options;

    const cleanupQueue = [];
    const id = `chatcmpl-${Math.random().toString(36).substring(7)}`;

    // Helper to add transient images to cleanup queue
    const handleTransientImage = async (data, isBase64 = false) => {
        let extension = '.png'; // Default
        let buffer;

        if (isBase64) {
            const mimeMatch = data.match(/^data:(image\/\w+);base64,/);
            if (mimeMatch) {
                const mime = mimeMatch[1];
                if (mime.includes('jpeg') || mime.includes('jpg')) extension = '.jpg';
                else if (mime.includes('gif')) extension = '.gif';
                else if (mime.includes('webp')) extension = '.webp';
            }
            const base64Data = data.replace(/^data:image\/\w+;base64,/, "");
            buffer = Buffer.from(base64Data, 'base64');
        } else {
            const response = await axios.get(data, { responseType: 'arraybuffer' });
            buffer = Buffer.from(response.data);
            const contentType = response.headers['content-type'];
            if (contentType) {
                if (contentType.includes('jpeg') || contentType.includes('jpg')) extension = '.jpg';
                else if (contentType.includes('gif')) extension = '.gif';
                else if (contentType.includes('webp')) extension = '.webp';
                else if (contentType.includes('png')) extension = '.png';
            }
        }

        const tempPath = path.join(os.tmpdir(), `gemini-vision-${id}-${Math.random().toString(36).substring(7)}${extension}`);
        fs.writeFileSync(tempPath, buffer);
        cleanupQueue.push(tempPath);
        return `@${tempPath}`;
    };

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

    try {
        const fileAttachments = [];
        const conversationParts = await Promise.all(conversationMessages.map(async (m) => {
            let contentParts = [];
            if (Array.isArray(m.content)) {
                for (const c of m.content) {
                    if (c.type === 'text') contentParts.push(c.text);
                    else if (c.type === 'image_url') {
                        const url = typeof c.image_url === 'string' ? c.image_url : c.image_url.url;

                        // Check for persistent file-xxxx
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
                            if (url.startsWith('data:image')) {
                                const path = await handleTransientImage(url, true);
                                fileAttachments.push(path);
                            } else if (url.startsWith('http')) {
                                const path = await handleTransientImage(url, false);
                                fileAttachments.push(path);
                            } else {
                                contentParts.push(`[Image: ${url}]`);
                            }
                        } catch (err) {
                            console.error('Failed to handle vision image:', err.message);
                            contentParts.push(`[Image Error: ${url}]`);
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
            const role = m.role === 'user' ? 'User' : 'Assistant';
            return `${role}: ${content}`;
        }));

        // Deduplicate attachments
        const uniqueAttachments = [...new Set(fileAttachments)];
        const prompt = [...uniqueAttachments, ...conversationParts].join(' ');

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
        if (options.model && options.model !== 'gemini-cli-bridge') {
            env.GEMINI_MODEL = options.model;
        }

        // Map generation parameters
        if (!settings.model) settings.model = {};
        if (!settings.model.modelConfig) settings.model.modelConfig = {};
        if (!settings.model.modelConfig.generateContentConfig) settings.model.modelConfig.generateContentConfig = {};

        const genConfig = settings.model.modelConfig.generateContentConfig;
        if (typeof temperature === 'number') genConfig.temperature = temperature;
        if (typeof top_p === 'number') genConfig.topP = top_p;
        if (typeof max_tokens === 'number') genConfig.maxOutputTokens = max_tokens;
        if (stop) {
            genConfig.stopSequences = Array.isArray(stop) ? stop : [stop];
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

        const voltaPath = 'C:\\Users\\h0tp\\AppData\\Local\\Volta\\bin\\gemini.cmd';
        const geminiPath = fs.existsSync(voltaPath) ? voltaPath : 'gemini';
        console.log(`Spawning Gemini CLI via path: ${geminiPath} (shell: false)`);

        const child = spawn(geminiPath, args, {
            stdio: ['inherit', 'pipe', 'pipe'],
            env,
            shell: false
        });

        const readline = require('readline');
        const rl = readline.createInterface({
            input: child.stdout,
            terminal: false
        });

        rl.on('line', (line) => {
            if (!line.trim()) return;
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
                // Not JSON - might be raw text from Gemini (thoughts, plans, etc.)
                if (line.includes('TOOL_CALL:') || isBufferingToolCall) {
                    // ... (keep tool call handling if needed, or just treat as text if it fails parsing)
                    // existing logic for tool calls is inside this block which I'm not overwriting fully
                    // actually I need to be careful not to break the existing tool handling logic if I rewrite the catch block.
                    // The previous logic was empty for the else case.
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
                } else if (fullResponse || stats) {
                    onEnd(id, model, fullResponse, stats);
                } else {
                    onEnd(id, model, "", null);
                }
            }
        };

        rl.on('close', () => {
            isRlClosed = true;
            maybeEnd();
        });

        child.on('close', (code) => {
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
