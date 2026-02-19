const http = require('http');

const redPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const chatData = JSON.stringify({
    messages: [
        {
            role: 'user',
            content: [
                { type: 'text', text: 'What color is this 1x1 pixel image?' },
                { type: 'image_url', image_url: { url: redPixel } }
            ]
        }
    ],
    model: 'gemini-2.5-flash'
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(chatData)
    }
};

const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    let data = '';
    res.on('data', (d) => data += d);
    res.on('end', () => {
        console.log('Response:', data);
    });
});

req.write(chatData);
req.end();
