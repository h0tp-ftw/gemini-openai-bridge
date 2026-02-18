const http = require('http');

const data = JSON.stringify({
    messages: [
        { role: 'system', content: 'You are a helpful pirate. Always end your sentences with Arrr!' },
        { role: 'user', content: 'Say "Bridge works!"' }
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
