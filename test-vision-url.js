const http = require('http');

const chatData = JSON.stringify({
    messages: [
        {
            role: 'user',
            content: [
                { type: 'text', text: 'What logo is in this image?' },
                { type: 'image_url', image_url: { url: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png' } }
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
