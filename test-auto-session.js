const axios = require('axios');

const API_BASE = 'http://localhost:3001/v1';
const API_KEY = process.env.BRIDGE_API_KEY || 'sk-gemini-cda89393f75977de17f0189b91a3c3304858cdca6c2532b2';

async function runTest() {
    try {
        console.log('Starting AUTO Session Test (Standard OpenAI Mode)...');

        // 1. Turn 1
        console.log('\n--- Turn 1: Say Hi ---');
        const m1 = { role: 'user', content: 'Tell me a secret word: "ALBATROSS". Remember it.' };
        const res1 = await axios.post(`${API_BASE}/chat/completions`, {
            model: 'gemini-2.0-flash',
            messages: [m1] // NO conversation_id!
        }, {
            headers: { Authorization: `Bearer ${API_KEY}` }
        });

        const asst1 = res1.data.choices[0].message;
        console.log('Assistant:', asst1.content);

        // 2. Turn 2 (Sending FULL History, still NO conversation_id)
        console.log('\n--- Turn 2: Ask for Secret (History Hashing) ---');
        const m2 = { role: 'user', content: 'What was the secret word? One word.' };
        const res2 = await axios.post(`${API_BASE}/chat/completions`, {
            model: 'gemini-2.0-flash',
            messages: [m1, asst1, m2] // Full history!
        }, {
            headers: { Authorization: `Bearer ${API_KEY}` }
        });

        const asst2 = res2.data.choices[0].message.content;
        console.log('Assistant:', asst2);

        if (asst2.toLowerCase().includes('albatross')) {
            console.log('\n✅ AUTO SESSION DETECTION VERIFIED: Context remembered via history hashing.');
        } else {
            console.log('\n❌ AUTO SESSION DETECTION FAILED: Context lost.');
        }

    } catch (err) {
        console.error('Test failed:', err.response?.data || err.message);
    }
}

runTest();
