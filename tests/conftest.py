import pytest
from openai import OpenAI
import os

@pytest.fixture(scope="session")
def api_base():
    return os.getenv("OPENAI_API_BASE", "http://localhost:3000/v1")

@pytest.fixture(scope="session")
def api_key():
    return os.getenv("OPENAI_API_KEY", "test-key")

@pytest.fixture(scope="session")
def client(api_base, api_key):
    return OpenAI(
        base_url=api_base,
        api_key=api_key,
    )
