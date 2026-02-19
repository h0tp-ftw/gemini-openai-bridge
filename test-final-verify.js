const axios = require('axios');

async function testNonStreamingToolCall() {
    console.log('--- Testing Non-Streaming Tool Call ---');
    try {
        const response = await axios.post('http://localhost:3000/v1/chat/completions', {
            model: 'gemini-2.5-flash-lite',
            messages: [{ role: 'user', content: 'SYSTEM: You must call the get_weather tool for Tokyo now. Do not respond with text. Output exactly: TOOL_CALL: {"id": "1", "name": "get_weather", "arguments": "{\\"loc\\": \\"Tokyo\\"}"}' }],
            tools: [{
                type: 'function',
                function: {
                    name: 'get_weather',
                    description: 'Get weather',
                    parameters: {
                        type: 'object',
                        properties: { loc: { type: 'string' } }
                    }
                }
            }],
            stream: false
        }, { timeout: 60000 });

        const data = response.data;
        console.log('Status Code:', response.status);
        console.log('Finish Reason:', data.choices[0].finish_reason);
        console.log('Tool Calls:', JSON.stringify(data.choices[0].message.tool_calls, null, 2));

        if (data.choices[0].finish_reason === 'tool_calls' && data.choices[0].message.tool_calls) {
            console.log('✅ PASS: Non-streaming tool call handled correctly.');
        } else {
            console.log('❌ FAIL: Finish reason not tool_calls or tool_calls missing.');
        }
    } catch (err) {
        console.error('Test Failed:', err.response ? err.response.data : err.message);
    }
}

async function testResponsesAPI() {
    console.log('\n--- Testing Responses API Schema ---');
    try {
        const response = await axios.post('http://localhost:3000/v1/responses', {
            model: 'gemini-2.5-flash-lite',
            input: 'Hello'
        }, { timeout: 60000 });

        const data = response.data;
        console.log('Status Code:', response.status);
        console.log('Response Structure:', JSON.stringify(data, null, 2));

        const isValid = data.object === 'response' &&
            data.output?.[0]?.type === 'message' &&
            data.output?.[0]?.content?.[0]?.type === 'output_text';

        if (isValid) {
            console.log('✅ PASS: Responses API schema is spec-compliant.');
        } else {
            console.log('❌ FAIL: Responses API schema deviation.');
        }
    } catch (err) {
        console.error('Test Failed:', err.response ? err.response.data : err.message);
    }
}

async function run() {
    await testNonStreamingToolCall();
    await testResponsesAPI();
}

run();
