const http = require('http');

async function runTest() {
    // 1. Upload a file
    const boundary = '--------------------------' + Math.random().toString(16).substring(2);
    const content = 'The secret password is: AGENTIC-AI-2026';
    const postData = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="purpose"',
        '',
        'user_data',
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="secret.txt"`,
        'Content-Type: text/plain',
        '',
        content,
        `--${boundary}--`,
        ''
    ].join('\r\n');

    const uploadOptions = {
        hostname: 'localhost',
        port: 3000,
        path: '/v1/files',
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const fileId = await new Promise((resolve) => {
        const req = http.request(uploadOptions, (res) => {
            let data = '';
            res.on('data', (d) => data += d);
            res.on('end', () => resolve(JSON.parse(data).id));
        });
        req.write(postData);
        req.end();
    });

    console.log('Uploaded file. ID:', fileId);

    // 2. Chat with the file
    const chatData = JSON.stringify({
        messages: [
            { role: 'user', content: `What is the secret password in the file ${fileId}?` }
        ],
        model: 'gemini-2.5-flash'
    });

    const chatOptions = {
        hostname: 'localhost',
        port: 3000,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(chatData)
        }
    };

    const chatReq = http.request(chatOptions, (res) => {
        console.log(`Chat Status: ${res.statusCode}`);
        res.on('data', (d) => process.stdout.write(d));
    });

    chatReq.write(chatData);
    chatReq.end();
}

runTest().catch(console.error);
