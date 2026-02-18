const http = require('http');

const data = JSON.stringify({
    messages: [{ role: 'user', content: 'Say "Non-stream works!"' }],
    stream: false,
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
    let body = '';
    res.on('data', (d) => {
        body += d;
    });
    res.on('end', () => {
        console.log('Response Body:', JSON.parse(body));
    });
});

req.on('error', (error) => {
    console.error(error);
});

req.write(data);
req.end();
