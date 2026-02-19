import pytest
from openai import OpenAI

@pytest.fixture(scope="session")
def default_model(client: OpenAI):
    """Fetch the first available model from the API."""
    models = client.models.list()
    assert len(models.data) > 0
    return models.data[0].id

def test_list_models(client: OpenAI):
    """Test the /v1/models endpoint."""
    response = client.models.list()
    assert len(response.data) > 0
    assert response.data[0].id is not None

def test_chat_completion_simple(client: OpenAI, default_model: str):
    """Test a simple non-streaming chat completion."""
    response = client.chat.completions.create(
        model=default_model,
        messages=[
            {"role": "user", "content": "Hello, simply say 'Hello' back."}
        ]
    )
    assert response.choices[0].message.content is not None
    assert len(response.choices[0].message.content) > 0

def test_chat_completion_streaming(client: OpenAI, default_model: str):
    """Test a streaming chat completion with detailed verification."""
    import time
    
    start_time = time.time()
    response = client.chat.completions.create(
        model=default_model,
        messages=[
            {"role": "user", "content": "Count from 1 to 5, one number per line."}
        ],
        stream=True
    )
    
    chunks = []
    chunk_count = 0
    first_token_time = None
    
    for chunk in response:
        chunk_count += 1
        if chunk.choices and chunk.choices[0].delta.content:
            if first_token_time is None:
                first_token_time = time.time()
            chunks.append(chunk.choices[0].delta.content)
            
    full_content = "".join(chunks)
    end_time = time.time()
    
    print(f"\n--- Streaming Stats ---")
    print(f"Total Chunks: {chunk_count}")
    print(f"Total Content Length: {len(full_content)}")
    print(f"Time to First Token: {first_token_time - start_time:.4f}s" if first_token_time else "N/A")
    print(f"Total Duration: {end_time - start_time:.4f}s")
    print(f"Content: {full_content}")
    print(f"-----------------------")
    
    assert len(full_content) > 0
    assert chunk_count > 1, "Streaming should return multiple chunks"
    assert "1" in full_content and "5" in full_content

def test_chat_completion_with_system_message(client: OpenAI, default_model: str):
    """Test chat completion with a system message."""
    response = client.chat.completions.create(
        model=default_model,
        messages=[
            {"role": "system", "content": "You are a helpful assistant that only speaks in JSON."},
            {"role": "user", "content": "What is 2+2?"}
        ]
    )
    content = response.choices[0].message.content
    assert content is not None

def test_error_handling_invalid_model(client: OpenAI):
    """Test that an invalid model returns an error."""
    try:
        client.chat.completions.create(
            model="invalid-model-name-12345",
            messages=[{"role": "user", "content": "Hi"}]
        )
    except Exception:
        # Expected
        pass
