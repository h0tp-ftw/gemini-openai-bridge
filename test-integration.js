const axios = require('axios');

const API_BASE = 'http://localhost:3001/v1';
const API_KEY = process.env.BRIDGE_API_KEY || 'sk-gemini-750b88e7cd5611b865839ad6feb48d67335aac41621e619a';
const CONV_ID = 'smart-test-' + Date.now();

async function runTest() {
    try {
        console.log(`Starting SMART Session Test (ID: ${CONV_ID})...`);

        // 1. First Turn
        console.log('\n--- Turn 1: Say Hi ---');
        const m1 = { role: 'user', content: 'My name is Antigravity. Remember it.' };
        const res1 = await axios.post(`${API_BASE}/chat/completions`, {
            model: 'gemini-2.5-flash-lite',
            conversation_id: CONV_ID,
            messages: [m1]
        }, {
            headers: { Authorization: `Bearer ${API_KEY}` }
        });

        const asst1 = res1.data.choices[0].message;
        console.log('Assistant:', asst1.content);

        // 2. Second Turn (Simulate OpenAI client sending full history)
        console.log('\n--- Turn 2: Ask for Name (Sending FULL History) ---');
        const m2 = { role: 'user', content: 'What is my name? Answer in one word.' };
        const res2 = await axios.post(`${API_BASE}/chat/completions`, {
            model: 'gemini-2.5-flash-lite',
            conversation_id: CONV_ID,
            messages: [m1, asst1, m2] // Full history!
        }, {
            headers: { Authorization: `Bearer ${API_KEY}` }
        });

        const asst2 = res2.data.choices[0].message.content;
        console.log('Assistant:', asst2);

        if (asst2.includes('Antigravity')) {
            console.log('\n✅ SMART RESUME VERIFIED: Context remembered despite full history payload.');
        } else {
            console.log('\n❌ SMART RESUME FAILED: Context lost or error.');
        }

        // 3. JSON Mode Test
        console.log('\n--- Turn 3: JSON Mode Test ---');
        const res3 = await axios.post(`${API_BASE}/chat/completions`, {
            model: 'gemini-2.5-flash-lite',
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: 'Return a JSON with your current mood.' }]
        }, {
            headers: { Authorization: `Bearer ${API_KEY}` }
        });

        const content = res3.data.choices[0].message.content;
        console.log('Assistant:', content);
        try {
            JSON.parse(content);
            console.log('✅ JSON MODE VERIFIED: Output is valid JSON.');
        } catch (e) {
            console.log('❌ JSON MODE FAILED: Output is not valid JSON.');
        }

    } catch (err) {
        console.error('Test failed:', err.response?.data || err.message);
    }
}

runTest();
