# gemini-openai-bridge

An OpenAI-compatible API bridge for the Gemini CLI. Express-based (Fastify) local server that translates v1/chat/completions to headless Gemini CLI calls.

## Prerequisites

- Node.js installed.
- `@google/gemini-cli` installed and authenticated on your system.
- `gemini` command available in your PATH (or configured in `src/bridge.js`).

## Installation

1. Clone or copy the project files.
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

1. Start the server:
   ```bash
   node index.js
   ```
### Available Endpoints

- `GET /v1/models`: Lists the available Gemini models.
- `POST /v1/chat/completions`: The standard OpenAI chat completion endpoint (Streaming & Non-Streaming).
- `POST /v1/responses`: Modern OpenAI Responses API endpoint, used by late-model SDKs like **Vercel AI SDK**.
- `GET/POST /v1/files`: Basic support for OpenAI-style file management (Gemini CLI backend).

## Compatible Toolsets

This bridge is tested and confirms compatibility with:
*   **Vercel AI SDK** (`@ai-sdk/openai`)
*   **opencode**
*   **VS Code: Continue**
*   **VS Code: Cline / Roo Code**
*   **Cursor**

## Example CURLs

### Chat Completions
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Say hello!"}],
    "stream": true
  }'
```

### Responses API (Modern SDKs)
```bash
curl http://localhost:3000/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "input": "How does the bridge work?"
  }'
```

## How it works

- **Robust Processing**: Uses `readline` to handle streamed output from Gemini CLI without race conditions.
- **OpenAI Compliance**: Returns standardized error objects and usage statistics (including caching info).
- **Request Translation**: OpenAI `messages` or `input` are combined into a single prompt for the Gemini CLI.
- **Process Management**: Spawns `gemini.cmd` (on Windows) in the background with `--output-format stream-json`.

## Automatic Caching

One of the most powerful features of using the Gemini CLI as a backend is **Automatic Context Caching**. 

As you continue a conversation through this bridge, the Gemini CLI automatically caches the context of your previous messages. This means:
- **Zero Configuration**: No need to manually manage cache TTLs or IDs.
- **Lower Latency**: Follow-up questions are processed significantly faster.
- **Cost Efficiency**: You only pay for the full input once; subsequent turns use the cache.

The bridge captures these caching statistics and reports them back in the standard OpenAI `usage` object.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
