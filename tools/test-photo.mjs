// Development fixture only: no provider requests, directory listing or app backend.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const path = process.argv[2];
if (!path) throw Error('Usage: node tools/test-photo.mjs /absolute/path/to/photo.jpg');
const photo = await readFile(path);
if (photo[0] !== 255 || photo[1] !== 216 || photo[2] !== 255) throw Error('Choose a JPEG test photo');
const server = createServer((req, res) => {
  if (req.headers.host !== '127.0.0.1:8767' && req.headers.host !== '10.0.2.2:8767') {
    res.writeHead(403); return res.end();
  }
  if (req.method !== 'GET' || req.url !== '/test-photo.jpg') {
    res.writeHead(404); return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': photo.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(photo);
});
server.listen(8767, '127.0.0.1', () => console.log('Local test photo: http://127.0.0.1:8767/test-photo.jpg (Android emulator: 10.0.2.2)'));
