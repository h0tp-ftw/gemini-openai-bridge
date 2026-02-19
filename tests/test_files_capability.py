import pytest
import aiohttp
import os
import io

API_BASE = os.getenv("OPENAI_API_BASE", "http://localhost:3001/v1")
API_KEY = os.getenv("OPENAI_API_KEY", "sk-gemini-cda89393f75977de17f0189b91a3c3304858cdca6c2532b2")

@pytest.mark.asyncio
async def test_file_upload_and_chat_usage():
    """
    Test uploading a file (mock image) and referencing it in a chat completion.
    """
    async with aiohttp.ClientSession() as session:
        # 1. Create a dummy file (text pretending to be something else, or just text)
        # For the bridge, the content doesn't matter as much as the file handling logic unless the CLI tries to read it immediately.
        # The bridge just passes the path.
        data = aiohttp.FormData()
        data.add_field('file', io.BytesIO(b"Hello from a file!"), filename='test_data.txt', content_type='text/plain')
        
        # Upload
        upload_url = f"{API_BASE}/files"
        headers = {"Authorization": f"Bearer {API_KEY}"}
        
        # aiohttp handles multipart uploads with 'data'
        async with session.post(upload_url, headers=headers, data=data) as response:
            assert response.status == 200
            file_obj = await response.json()
            print(f"\nUploaded file: {file_obj}")
            assert "id" in file_obj
            assert file_obj["id"].startswith("file-")
            file_id = file_obj["id"]

        # 2. Use file in Chat
        # We'll just check if the call succeeds. The bridge logs should show attachment if we could see them.
        chat_url = f"{API_BASE}/chat/completions"
        chat_headers = {
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        }
        
        # Case A: File in text content
        data_text = {
            "model": "gemini-2.5-flash-lite",
            "messages": [
                {"role": "user", "content": f"Please read this file: {file_id}"}
            ],
            "max_tokens": 10
        }
        
        async with session.post(chat_url, headers=chat_headers, json=data_text) as response:
            assert response.status == 200
            result = await response.json()
            assert result["choices"][0]["message"]["content"] is not None

        # Case B: File as image_url (even if it's text, the bridge treats file- IDs in image_url as attachments)
        data_image = {
            "model": "gemini-2.5-flash-lite",
            "messages": [
                {
                    "role": "user", 
                    "content": [
                        {"type": "text", "text": "What is this?"},
                        {"type": "image_url", "image_url": {"url": file_id}}
                    ]
                }
            ],
            "max_tokens": 10
        }

        async with session.post(chat_url, headers=chat_headers, json=data_image) as response:
            assert response.status == 200
            result = await response.json()
            assert result["choices"][0]["message"]["content"] is not None
