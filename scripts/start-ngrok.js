const { spawn } = require('child_process');

console.log('Starting ngrok tunnel for port 3000...');
const ngrok = spawn('ngrok.cmd', ['http', '3000', '--log=stdout'], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

ngrok.stdout.on('data', (d) => {
  const line = d.toString();
  process.stdout.write(line);
});

ngrok.stderr.on('data', (d) => {
  process.stderr.write(d.toString());
});

ngrok.on('close', (code) => {
  console.log('ngrok exited with code', code);
  process.exit(code || 0);
});
