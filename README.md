# gemini-openai-bridge

An OpenAI-compatible API bridge for the Gemini CLI. Fastify-based local server that translates v1/chat/completions to headless Gemini CLI calls.

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
