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
2. The endpoint will be available at `http://localhost:3000/v1/chat/completions`.

## Example CURL (Streaming)

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-pro",
    "messages": [{"role": "user", "content": "Say hello!"}],
    "stream": true
  }'
```

## How it works

- **Request Translation**: OpenAI `messages` are combined into a single prompt for the Gemini CLI.
- **Process Management**: Spawns `gemini -p <prompt> --output-format stream-json --yolo` in the background.
- **Response Translation**: Translates Gemini's periodic JSON updates into OpenAI Server-Sent Events (SSE).

## Automatic Caching

One of the most powerful features of using the Gemini CLI as a backend is **Automatic Context Caching**. 

As you continue a conversation through this bridge, the Gemini CLI automatically caches the context of your previous messages. This means:
- **Zero Configuration**: No need to manually manage cache TTLs or IDs.
- **Lower Latency**: Follow-up questions are processed significantly faster.
- **Cost Efficiency**: You only pay for the full input once; subsequent turns use the cache.

The bridge captures these caching statistics and reports them back in the standard OpenAI `usage` object.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
