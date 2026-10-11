import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// Artifact marks painted on the editor (src/marks.ts), one JSON file and one
// screenshot per mark in marks/. Dev server only.
//   GET /__marks          every mark (without screenshots)
//   POST /__marks         save a mark: JSON with `shot` as a PNG data URL
//   DELETE /__marks/<id>  remove a mark
//   DELETE /__marks       remove every mark
function marks(): Plugin {
  const dir = root + 'marks/';
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  return {
    name: 'marks',
    apply: 'serve',
    config: () => ({ server: { watch: { ignored: [dir + '**'] } } }),
    configureServer(server) {
      server.middlewares.use('/__marks', (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        mkdirSync(dir, { recursive: true });
        if (req.method === 'GET') {
          const marks = readdirSync(dir)
            .filter((f) => f.endsWith('.json'))
            .sort()
            .map((f) => JSON.parse(readFileSync(dir + f, 'utf8')));
          return send(200, marks);
        }
        if (req.method === 'DELETE') {
          const id = (req.url ?? '').replace(/^\//, '');
          if (!id) {
            // Only plain mark files: names from the folder itself, nothing else.
            const files = readdirSync(dir).filter((f) => /^[\w-]+\.(json|png)$/.test(f));
            files.forEach((f) => rmSync(dir + f, { force: true }));
            return send(200, { removed: files.length });
          }
          if (!/^[\w-]+$/.test(id)) return send(400, { error: 'bad id' });
          rmSync(dir + id + '.json', { force: true });
          rmSync(dir + id + '.png', { force: true });
          return send(200, { id });
        }
        if (req.method !== 'POST') return send(405, { error: 'method' });
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const mark = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const t = new Date(),
            pad = (n: number) => String(n).padStart(2, '0'),
            stamp = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`,
            id = `${stamp}-${String(mark.variant).replace(/[^\w-]/g, '')}`;
          const shot = String(mark.shot ?? '').replace(/^data:image\/png;base64,/, '');
          if (shot) writeFileSync(dir + id + '.png', Buffer.from(shot, 'base64'));
          // The geometry the mark was drawn on: the commit, and whether the
          // shape code had uncommitted changes.
          const dirty = git('status', '--porcelain', '--', 'src').length > 0;
          const saved = {
            id,
            time: t.toISOString(),
            commit: git('rev-parse', '--short', 'HEAD') + (dirty ? '+dirty' : ''),
            ...mark,
            shot: shot ? id + '.png' : undefined,
          };
          writeFileSync(dir + id + '.json', JSON.stringify(saved, null, 1) + '\n');
          send(200, saved);
        });
      });
    },
  };
}

// Workers as modules: the build worker starts the wiring worker.
export default defineConfig({ plugins: [marks()], worker: { format: 'es' } });
