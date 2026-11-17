const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { prepareAssets } = require('./prepare-assets.cjs');
const root = path.resolve(__dirname, '../dist');
const port = Number(process.env.PREVIEW_PORT) || 5192;
prepareAssets(root);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.glb':'model/gltf-binary', '.bin':'application/octet-stream', '.gz':'application/gzip', '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.txt':'text/plain; charset=utf-8', '.md':'text/plain; charset=utf-8' };
http.createServer((req,res)=>{
  let relative;
  try { relative = decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/skyfall-mobile\//,'/'); } catch { res.writeHead(400).end(); return; }
  if (relative.endsWith('/')) relative += 'index.html';
  const file = path.resolve(root, '.' + relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404).end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':fs.statSync(file).size,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
}).listen(port,'127.0.0.1',()=>process.stdout.write('Local support guidance preview: http://127.0.0.1:'+port+'/\n'));
