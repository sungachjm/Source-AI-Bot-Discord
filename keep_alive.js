// keep_alive.js
const http = require('http');

const PORT = process.env.PORT || 3000;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>THMEO-X | Status</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0d0d0d;
      color: #e0e0e0;
      font-family: 'Courier New', monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 16px;
    }
    .dot {
      width: 14px; height: 14px;
      background: #00ff88;
      border-radius: 50%;
      box-shadow: 0 0 10px #00ff88;
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    h1 { font-size: 1.4rem; letter-spacing: 0.2em; color: #ffffff; }
    p { font-size: 0.8rem; color: #555; }
  </style>
</head>
<body>
  <div class="dot"></div>
  <h1>THMEO-X</h1>
  <p>bot is alive</p>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`✅ Keep-alive server running on port ${PORT}`);
});

module.exports = server;
