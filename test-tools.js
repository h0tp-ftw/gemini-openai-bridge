const http = require('http');

const data = JSON.stringify({
    messages: [
        { role: 'user', content: 'What is the weather in London?' }
    ],
    tools: [
        {
            type: 'function',
            function: {
                name: 'get_weather',
                description: 'Get the current weather in a given location',
                parameters: {
                    type: 'object',
                    properties: {
                        location: { type: 'string', description: 'The city name' }
                    },
                    required: ['location']
                }
            }
        }
    ],
    stream: true,
    model: 'gemini-pro'
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    res.on('data', (d) => {
        process.stdout.write(d);
    });
});

req.on('error', (error) => {
    console.error(error);
});

req.write(data);
req.end();
