const axios = require('axios');

const API_BASE = 'http://localhost:3001/v1';
const API_KEY = 'sk-gemini-cda89393f75977de17f0189b91a3c3304858cdca6c2532b2';

// Exact payload from user request
const messages = [
    {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": "<user_message>\nhello, what you think of this prokect\n</user_message>"
            },
            {
                "type": "text",
                "text": "<environment_details>\n# VSCode Visible Files\n\n\n# VSCode Open Tabs\ntest-responses-endpoint.js,test-ai-sdk-vercel.js,test-endpoint.js,simulate-roocode.js,test-integration.js,../../../AppData/Local/Temp/roo-debug-api-019c76b4-1771518067681.json,generate-key.js,src/session-store.js,package.json,test-auto-session.js,test-final-verify.js,tests/test_bridge_master.py,tests/test_files_capability.py,tests/test_complex_payload.py,tests/test_litellm_adapted.py,repro_spawn.js,verify_bridge.ps1,tests/test_openai_compliance.py,tests/conftest.py,requirements-test.txt\n\n# Current Time\nCurrent time in ISO 8601 UTC format: 2026-02-19T16:35:46.374Z\nUser time zone: Etc/GMT+7, UTC-7:00\n\n# Current Cost\n$0.00\n\n# Current Mode\n<slug>architect</slug>\n<name>🏗️ Architect</name>\n<model>auto-gemini-3</model>\n\n\n# Current Workspace Directory (c:/Users/h0tp/Documents/Code/gemini-cli-openai) Files\n.gitignore\ngemini-settings.json\ngenerate-key.js\nindex.js\nLICENSE\npackage.json\nREADME.md\nrepro_spawn.js\ntest-auto-session.js\ntest-bridge.js\ntest-files-chat.js\ntest-files-upload.js\ntest-final-verify.js\ntest-integration.js\ntest-models.js\ntest-non-stream.js\ntest-tools.js\ntest-vision-base64.js\ntest-vision-url.js\nverify_bridge.ps1\nverify-compatibility.js\nsrc/\nsrc/bridge.js\nsrc/file-manager.js\nsrc/openai-utils.js\nsrc/session-store.js\ntests/\ntests/conftest.py\ntests/test_bridge_master.py\ntests/test_complex_payload.py\ntests/test_files_capability.py\ntests/test_litellm_adapted.py\ntests/test_openai_compliance.py\nYou have not created a todo list yet. Create one with `update_todo_list` if your task is complicated or involves multiple steps.\n</environment_details>"
            }
        ]
    }
];

const payload = {
    "model": "auto-gemini-3", // Respecting the user's exact model name
    "messages": messages,
    "stream": false
};

async function runRepo() {
    try {
        console.log('Sending exact Roo Code payload with model: auto-gemini-3...');
        const res = await axios.post(`${API_BASE}/chat/completions`, payload, {
            headers: { Authorization: `Bearer ${API_KEY}` }
        });
        console.log('SUCCESS:', res.data.choices[0].message.content);
    } catch (err) {
        console.error('FAILED:', err.response?.data || err.message);
    }
}

runRepo();
