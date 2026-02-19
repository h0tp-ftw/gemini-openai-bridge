const fs = require('fs');
const http = require('http');
const path = require('path');

const filePath = path.join(__dirname, 'test-asset.txt');
fs.writeFileSync(filePath, 'Hello from Gemini Bridge Test File!');

const boundary = '--------------------------' + Math.random().toString(16).substring(2);

const postData = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="purpose"',
    '',
    'user_data',
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"`,
    'Content-Type: text/plain',
    '',
    fs.readFileSync(filePath, 'utf8'),
    `--${boundary}--`,
    ''
].join('\r\n');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/v1/files',
    method: 'POST',
    headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(postData)
    }
};

const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log('Response:', data);
        const response = JSON.parse(data);
        if (response.id) {
            console.log('UPLOAD SUCCESS. ID:', response.id);
            // Verify listing
            http.get('http://localhost:3000/v1/files', (res2) => {
                let data2 = '';
                res2.on('data', (chunk) => data2 += chunk);
                res2.on('end', () => {
                    console.log('Files List:', data2);
                });
            });
        }
    });
});

req.on('error', (e) => console.error(e));
req.write(postData);
req.end();
