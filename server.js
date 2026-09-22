const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

console.log(`[Hostinger] Initializing Next.js app in ${dev ? 'development' : 'production'} mode on port ${port}...`);

app.prepare().then(() => {
  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('[Hostinger] Error handling request:', req.url, err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  })
    .once('error', (err) => {
      console.error('[Hostinger] Server failed to start:', err);
      process.exit(1);
    })
    .listen(port, hostname, () => {
      console.log(`[Hostinger] Ready on http://${hostname}:${port}`);
    });
}).catch((err) => {
  console.error('[Hostinger] Error during app.prepare():', err);
  process.exit(1);
});
