import pytest
import httpx
import json
import os
from openai import OpenAI, AsyncOpenAI

# Configuration
API_BASE = os.getenv("OPENAI_API_BASE", "http://localhost:3001/v1")
API_KEY = os.getenv("OPENAI_API_KEY", "test-key")
MODEL = "gemini-2.5-flash-lite" # Use a known model

@pytest.fixture
def client():
    return OpenAI(base_url=API_BASE, api_key=API_KEY)

@pytest.fixture
def aclient():
    return AsyncOpenAI(base_url=API_BASE, api_key=API_KEY)

def test_list_models(client):
    response = client.models.list()
    assert len(response.data) > 0
    assert any(m.id == MODEL for m in response.data)

def test_chat_completion_simple(client):
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Say 'Bridge verified'"}],
        temperature=0
    )
    assert "Bridge verified" in response.choices[0].message.content
    assert response.choices[0].finish_reason == "stop"

@pytest.mark.asyncio
async def test_streaming_compliance():
    """Verify first chunk role and final chunk finish_reason."""
    async with httpx.AsyncClient() as client:
        payload = {
            "model": MODEL,
            "messages": [{"role": "user", "content": "Hi"}],
            "stream": True
        }
        
        chunks = []
        async with client.stream("POST", f"{API_BASE}/chat/completions", json=payload, timeout=60.0) as response:
            assert response.status_code == 200
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break
                    chunks.append(json.loads(data_str))

        assert len(chunks) > 0
        
        # 1. First content chunk should have role: assistant
        first_content_chunk = next((c for c in chunks if c["choices"] and "content" in c["choices"][0]["delta"]), None)
        assert first_content_chunk is not None
        assert first_content_chunk["choices"][0]["delta"]["role"] == "assistant"
        
        # 2. Final chunk should have finish_reason: stop
        last_chunk = chunks[-1]
        assert last_chunk["choices"][0]["finish_reason"] == "stop"

@pytest.mark.asyncio
async def test_streaming_tool_calls():
    """Verify finish_reason: tool_calls in streaming."""
    tools = [{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get weather",
            "parameters": {
                "type": "object",
                "properties": {"loc": {"type": "string"}}
            }
        }
    }]
    
    async with httpx.AsyncClient() as client:
        payload = {
            "model": MODEL,
            "messages": [{"role": "user", "content": "What is the weather in Tokyo? Respond ONLY with a tool call."}],
            "tools": tools,
            "stream": True
        }
        
        chunks = []
        async with client.stream("POST", f"{API_BASE}/chat/completions", json=payload, timeout=60.0) as response:
            assert response.status_code == 200
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break
                    chunks.append(json.loads(data_str))

        # Check for tool call emits
        tool_call_chunks = [c for c in chunks if c["choices"] and "tool_calls" in c["choices"][0]["delta"]]
        assert len(tool_call_chunks) > 0
        
        # Verify finish_reason on the last chunk before [DONE]
        assert chunks[-1]["choices"][0]["finish_reason"] == "tool_calls"

def test_non_streaming_tool_calls(client):
    """Verify tool_calls field and finish_reason in non-streaming."""
    tools = [{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get weather",
            "parameters": {
                "type": "object",
                "properties": {"loc": {"type": "string"}}
            }
        }
    }]
    
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "What is the weather in Tokyo? Respond ONLY with a tool call."}],
        tools=tools,
        stream=False
    )
    
    assert response.choices[0].finish_reason == "tool_calls"
    assert len(response.choices[0].message.tool_calls) > 0
    assert response.choices[0].message.tool_calls[0].function.name == "get_weather"

def test_responses_api_schema():
    """Verify the /v1/responses format matches the improved schema."""
    with httpx.Client() as client:
        payload = {
            "model": MODEL,
            "input": "Hello"
        }
        response = client.post(f"{API_BASE}/responses", json=payload, timeout=60.0)
        assert response.status_code == 200
        data = response.json()
        
        # Check structure
        assert data["object"] == "response"
        assert "output" in data
        assert isinstance(data["output"], list)
        assert data["output"][0]["type"] == "message"
        assert data["output"][0]["content"][0]["type"] == "output_text"
        assert "text" in data["output"][0]["content"][0]
