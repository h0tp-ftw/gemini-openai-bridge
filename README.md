# gemini-openai-bridge

An OpenAI-compatible API bridge for the Gemini CLI. Fastify-based local server that translates v1/chat/completions to headless Gemini CLI calls.

## ⚠️ Archive Notice: Check out the successor [Ionosphere](https://github.com/h0tp-ftw/ionosphere)

This project was an attempt to wrap the Google Gemini Command Line Interface (CLI) in a local HTTP server to act as a drop-in, OpenAI-compatible API endpoint. While technically functional for basic text generation, it was archived due to insurmountable architectural bottlenecks and latency issues when dealing with complex agentic loops (e.g., OpenClaw).

**It is a dead end.** The fundamental mismatch between a stateless HTTP protocol and a stateful, local CLI process creates the following hard limitations:

### 1. The ReAct Loop Latency (Process Spawning Overhead)
The OpenAI API specification expects rapid, stateless HTTP responses. Because this proxy wraps a CLI binary, every incoming request forces the OS to spawn a new shell process, authenticate, initialize the Go/Node environment, execute, and tear down. In a multi-step ReAct agent loop requiring 10-20 sequential tool calls, this introduces a compounding 3 to 5-second startup penalty per turn. The compounding dead time suffocates agentic performance.

### 2. The Execution Mismatch (The "Two Managers" Problem)
The OpenAI tool-calling spec dictates that the server acts as a passive brain: it returns a JSON tool_calls intent, and the client executes the code.
However, the Gemini CLI has its own internal reasoning loop and executes tools natively (via its own TypeScript tools or local MCP servers). Stacking an OpenAI proxy on top of an agentic CLI strips the client application of its execution control. The proxy either returns unparsable text blocks instead of JSON tool intents, or requires highly unstable, custom client-side modifications that defeat the purpose of a "universal" proxy.

### 3. The Context Wall (OS vs. Statelessness)
Because the OpenAI protocol is stateless, every request must include the entire conversation history. Passing 30,000+ tokens of JSON history to a CLI binary natively hits hard OS limits (e.g., the 8191-character ARG_MAX limit in Windows cmd.exe). Bypassing this by piping temporary files to stdin creates a massive Disk I/O bottleneck and garbage collection nightmare for every single API call.

### 4. Concurrency and File-Locking Collisions
The Gemini CLI relies on a global, persistent configuration file (e.g., `settings.json`) to manage state and connections. A stateless HTTP proxy attempting to serve concurrent requests cannot dynamically overwrite this global configuration file to map temporary tool environments without causing immediate file-locking crashes and race conditions.

### 5. Stream Fragmentation
Capturing the CLI's standard output (stdout) pipe to translate streaming JSON chunks back to the client is highly fragile. OS-level pipes do not respect JSON object boundaries and flush based on arbitrary byte buffers. This causes fragmented JSON strings that require complex, brittle accumulation logic that breaks immediately upon minor CLI formatting updates.

## Prerequisites

- Node.js installed.
- `@google/gemini-cli` installed and authenticated on your system.
- `gemini` command available in your PATH.

## Installation

1. Clone or copy the project files.
2. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

### 1. API Key (Optional)
By default, the bridge is open. To secure it, generate a key:
```bash
node generate-key.js
```
This adds `BRIDGE_API_KEY=sk-gemini-...` to your `.env`. Clients must then send `Authorization: Bearer sk-gemini-...`.

### 2. Available Models
Configure models in `gemini-settings.json` to customize the `/v1/models` list:
```json
{
  "general": {
    "previewFeatures": true
  },
  "models": [
    { "id": "gemini-2.5-flash-lite", "owned_by": "google" },
    { "id": "gemini-2.0-pro-exp-02-05", "owned_by": "google" }
  ]
}
```

## Usage

Start the server:
```bash
node index.js
```

### Endpoints

6. **Models**: The bridge exposes the following models by default (plus any you add to `gemini-settings.json`):
    - `gemini-2.5-flash-lite` (Default, Fast & Cheap)
    - `gemini-2.0-pro-exp-02-05` (Reasoning & Complex Tasks)
    - `gemini-2.0-flash-exp` (High Speed)
- `GET /v1/models`: Lists Gemini models.
- `POST /v1/chat/completions`: Standard chat endpoint (Streaming & Non-Streaming).
- `POST /v1/responses`: Modern Responses API.
- `GET/POST/DELETE /v1/files`: Complete OpenAI-style file management.
- `GET /v1/files/:id/content`: Download uploaded file content.

### Multi-turn Conversations (Sessions)

To maintain context across separate API calls, send a `conversation_id` in your request body:
```json
{
  "model": "gemini-2.5-flash-lite",
  "conversation_id": "unique-session-123",
  "messages": [{"role": "user", "content": "What did I just say?"}]
}
```
The bridge maps this to a Gemini CLI session ID and uses `--resume`. This enables **Automatic Context Caching** on the Gemini backend.

## How it works

- **Generic File Handling**: Any file attached as base64 or URL is saved to temp and passed to Gemini CLI via `@path`. Supports image, PDF, text, etc.
- **Robust Processing**: Uses `readline` to handle streamed output without race conditions.
- **Timeouts**: CLI processes are killed after 120s (configurable via `BRIDGE_TIMEOUT_MS`) to prevent hanging.
- **JSON Mode**: Supports `response_format: { type: "json_object" }` by forcing JSON output.

## License

MIT License - see [LICENSE](LICENSE) for details.
