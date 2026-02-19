const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '.env');
const key = `sk-gemini-${crypto.randomBytes(24).toString('hex')}`;

let envContent = '';
if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
}

if (envContent.includes('BRIDGE_API_KEY=')) {
    envContent = envContent.replace(/BRIDGE_API_KEY=.*/, `BRIDGE_API_KEY=${key}`);
} else {
    envContent += `\nBRIDGE_API_KEY=${key}\n`;
}

fs.writeFileSync(envPath, envContent.trim() + '\n');

console.log('--------------------------------------------------');
console.log('Gemini CLI OpenAI Bridge - API Key Generated');
console.log('--------------------------------------------------');
console.log(`Key: ${key}`);
console.log('Added to your .env file as BRIDGE_API_KEY.');
console.log('Use this in your OpenAI client as the API Key.');
console.log('--------------------------------------------------');
