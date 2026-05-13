import { join, normalize, resolve } from 'node:path';

export async function serveStaticSpa(req: Request, distRoot: string): Promise<Response> {
  const root = resolve(distRoot);
  const pathname = decodeURIComponent(new URL(req.url).pathname);
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);

  const filePath = normalize(join(root, requested));
  if (filePath !== root && !filePath.startsWith(root + '/')) {
    return new Response('Forbidden', { status: 403 });
  }

  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file);
  }

  const indexFile = Bun.file(join(root, 'index.html'));
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new Response('Not Found', { status: 404 });
}
