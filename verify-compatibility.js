const axios = require('axios');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000/v1';

async function testModels() {
    console.log('--- Testing /v1/models ---');
    const res = await axios.get(`${BASE_URL}/models`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.object, 'list');
    assert(Array.isArray(res.data.data));
    console.log('✓ /v1/models is compatible');
}

async function testChatCompletions() {
    console.log('--- Testing /v1/chat/completions (Non-Streaming) ---');
    const res = await axios.post(`${BASE_URL}/chat/completions`, {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Say OK' }],
        stream: false
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.object, 'chat.completion');
    assert(res.data.choices[0].message.content);
    assert(res.data.usage, 'Usage statistics missing');
    console.log('✓ /v1/chat/completions (Non-Streaming) is compatible');
}

async function testResponses() {
    console.log('--- Testing /v1/responses (Non-Streaming) ---');
    const res = await axios.post(`${BASE_URL}/responses`, {
        model: 'gemini-2.5-flash',
        input: 'Say OK',
        stream: false
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.object, 'response');
    assert.strictEqual(res.data.status, 'completed');
    assert(res.data.output[0].text);
    console.log('✓ /v1/responses (Non-Streaming) is compatible');
}

async function testErrorFormat() {
    console.log('--- Testing Error Response Format ---');
    try {
        await axios.post(`${BASE_URL}/chat/completions`, {
            messages: "not-an-array" // Invalid on purpose
        });
    } catch (error) {
        const body = error.response.data;
        assert(body.error, 'Error object missing');
        assert(body.error.message, 'Error message missing');
        console.log('✓ Error format is compatible');
        return;
    }
    throw new Error('Server did not return error for invalid request');
}

async function main() {
    try {
        await testModels();
        await testChatCompletions();
        await testResponses();
        await testErrorFormat();
        console.log('\nALL COMPATIBILITY TESTS PASSED! 🚀');
    } catch (e) {
        console.error('\nCOMPATIBILITY TEST FAILED ❌');
        console.error(e.message);
        if (e.response) console.error(JSON.stringify(e.response.data, null, 2));
        process.exit(1);
    }
}

main();
