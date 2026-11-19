// Servidor local que imita a Vercel: sirve los archivos estáticos y las funciones de /api.
// Uso:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/dev.mjs   (puerto 3000)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.env.PORT || 3000);
const TIPOS = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json'
};

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PUERTO}`);
    try {
        if (url.pathname.startsWith('/api/')) {
            const nombre = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
            const archivo = path.join(RAIZ, 'api', `${nombre}.js`);
            await fs.access(archivo);
            const modulo = await import(`${pathToFileURL(archivo).href}?v=${Date.now()}`);
            return await modulo.default(req, res);
        }
        let ruta = decodeURIComponent(url.pathname);
        if (ruta.endsWith('/')) ruta += 'index.html';
        const archivo = path.join(RAIZ, path.normalize(ruta));
        if (!archivo.startsWith(RAIZ) || /[\\/](api|scripts|supabase|node_modules|\.git)[\\/]/.test(archivo.slice(RAIZ.length))) throw new Error('prohibido');
        const contenido = await fs.readFile(archivo);
        res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
        res.end(contenido);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('No encontrado');
    }
}).listen(PUERTO, () => console.log(`Servidor local en http://localhost:${PUERTO}`));
