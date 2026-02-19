const { spawn } = require('cross-spawn');
const path = require('path');

const geminiPath = 'C:\\Users\\h0tp\\AppData\\Local\\Volta\\bin\\gemini.cmd';
const args = ['-p', 'Hello', '--output-format', 'stream-json', '--yolo', '--model', 'gemini-2.5-flash'];

console.log(`Spawning ${geminiPath}`);

const child = spawn(geminiPath, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false
});

child.stdout.on('data', (data) => {
    console.log(`STDOUT: ${data}`);
});

child.stderr.on('data', (data) => {
    console.error(`STDERR: ${data}`);
});

child.on('error', (err) => {
    console.error(`ERROR: ${err.message}`);
});

child.on('close', (code) => {
    console.log(`EXIT CODE: ${code}`);
});
