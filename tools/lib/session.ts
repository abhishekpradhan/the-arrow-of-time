// Starts Vite (with a raw-frame sink) + headless Chromium, and opens render pages.

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { ROOT } from './util';

export type FrameHandler = (worker: string, frame: number, data: Buffer) => Promise<void> | void;

function frameSink(getHandler: () => FrameHandler): Plugin {
  return {
    name: 'frame-sink',
    configureServer(server) {
      server.middlewares.use('/__frame', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://local');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', async () => {
          try {
            await getHandler()(url.searchParams.get('w') ?? '0', Number(url.searchParams.get('i')), Buffer.concat(chunks));
            res.statusCode = 200;
            res.end('ok');
          } catch (e) {
            console.error(e);
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export type GlMode = 'auto' | 'egl' | 'vulkan' | 'swiftshader' | 'gpu';

export function resolveGl(mode: GlMode): Exclude<GlMode, 'auto'> {
  if (mode !== 'auto') return mode;
  if (process.platform === 'darwin' || process.platform === 'win32') return 'gpu';
  // Linux: use the real GPU if a render node exists, otherwise Mesa llvmpipe through EGL
  // (about 3x faster than SwiftShader on CPU-only machines).
  const hasGpu = existsSync('/dev/dri') && readdirSync('/dev/dri').some((f) => f.startsWith('renderD'));
  return hasGpu ? 'gpu' : 'egl';
}

export function chromiumArgs(mode: Exclude<GlMode, 'auto'>): string[] {
  const common = [
    '--ignore-gpu-blocklist',
    '--disable-gpu-watchdog',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-webgl',
    // Containers often have a tiny /dev/shm (the Modal pipeline sets this).
    ...(process.env.STUDIO_NO_DEV_SHM ? ['--disable-dev-shm-usage'] : []),
  ];
  switch (mode) {
    case 'egl':
      return [...common, '--use-gl=angle', '--use-angle=gl-egl'];
    case 'vulkan':
      return [...common, '--use-angle=vulkan', '--enable-features=Vulkan'];
    case 'swiftshader':
      return [...common, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
    case 'gpu':
      return [...common, '--enable-gpu'];
  }
}

export interface Session {
  server: ViteDevServer;
  url: string;
  browser: Browser;
  setHandler(h: FrameHandler): void;
  openRenderPage(opts: {
    width?: number;
    height?: number;
    motionBlur?: boolean;
    debug?: boolean;
    infoOnly?: boolean;
    /** Captions only, over black, with no grain, bloom or vignette (typography checks). */
    textOnly?: boolean;
  }): Promise<Page>;
  close(): Promise<void>;
}

export async function startSession(gl: GlMode = 'auto'): Promise<Session> {
  let handler: FrameHandler = () => {};
  const server = await createServer({
    root: ROOT,
    configFile: `${ROOT}/vite.config.ts`,
    logLevel: 'warn',
    server: { port: 0, strictPort: false, hmr: false },
    plugins: [frameSink(() => handler)],
  });
  await server.listen();
  const url = (server.resolvedUrls?.local[0] ?? 'http://localhost:5173/').replace(/\/?$/, '/');
  const mode = resolveGl(gl);
  // MOVIES_BROWSER picks the browser binary: a Playwright channel ('chrome', 'msedge',
  // 'chromium') or the path of a Chromium executable. Unset, Playwright's own Chromium is used.
  const pick = process.env.MOVIES_BROWSER;
  const launch = pick ? (pick.includes('/') || pick.includes('\\') ? { executablePath: pick } : { channel: pick }) : {};
  const browser = await chromium.launch({ headless: true, args: chromiumArgs(mode), ...launch });
  console.log(`[session] vite ${url}  gl=${mode}${pick ? `  browser=${pick}` : ''}`);

  return {
    server,
    url,
    browser,
    setHandler(h) {
      handler = h;
    },
    async openRenderPage(o) {
      const page = await browser.newPage();
      page.on('console', (m) => {
        const text = m.text();
        if (m.type() === 'error' || m.type() === 'warning') console.log(`[page:${m.type()}] ${text}`);
        else if (process.env.MOVIES_VERBOSE) console.log(`[page] ${text}`);
      });
      page.on('pageerror', (e) => console.error(`[page:exception] ${e.message}`));
      const q = new URLSearchParams();
      if (o.width) q.set('w', String(o.width));
      if (o.height) q.set('h', String(o.height));
      if (o.motionBlur === false) q.set('mb', '0');
      if (o.debug) q.set('debug', '1');
      if (o.infoOnly) q.set('info', '1');
      if (o.textOnly) q.set('textonly', '1');
      await page.goto(`${url}render.html?${q}`);
      await page.waitForFunction(() => window.__movie && window.__movie.status !== 'loading', null, {
        timeout: 0,
        polling: 250,
      });
      const status = await page.evaluate(() => window.__movie.status);
      if (status !== 'ready') {
        const err = await page.evaluate(() => window.__movie.error);
        throw new Error(`Render page failed to load:\n${err}`);
      }
      return page;
    },
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

export type ProjectInfo = {
  id: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  frames: number;
  audio?: string;
  shots: { id: string; start: number; end: number }[];
};

export function pageInfo(page: Page): Promise<ProjectInfo> {
  return page.evaluate(() => window.__movie.info());
}
