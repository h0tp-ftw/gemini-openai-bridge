import pytest
from openai import OpenAI

@pytest.fixture(scope="session")
def default_model(client: OpenAI):
    models = client.models.list()
    return models.data[0].id

def test_complex_content_payload(client: OpenAI, default_model: str):
    """Test a payload with an array of content parts."""
    
    response = client.chat.completions.create(
        model=default_model,
        messages=[
            {
                "role": "user", 
                "content": [
                    {
                        "type": "text",
                        "text": "<user_message>\nhello\n</user_message>"
                    },
                    {
                        "type": "text",
                        "text": "<environment_details>\n# VSCode Visible Files\n..\\..\\..\\AppData\\Local\\Temp\\roo-diagnostics.json\n\n# Current Time\n2026-02-19T04:55:08.424Z\n</environment_details>"
                    }
                ]
            }
        ]
    )
    print("\nResponse Content:", response.choices[0].message.content)
    assert response.choices[0].message.content is not None
    assert len(response.choices[0].message.content) > 0
