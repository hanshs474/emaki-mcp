/**
 * emaki remote MCP server (Streamable HTTP, stateless, JSON responses).
 *
 * The same four tools as the npm package (`npx -y emaki-mcp`), served over
 * HTTP for clients that connect to a URL instead of starting a process.
 *
 * Every call is forwarded to emaki.ai's public API with the caller's own key,
 * taken from the request: `Authorization: Bearer sk-...`, an `x-emaki-api-key`
 * header, or an `apiKey` query parameter (the shape Smithery's session config
 * uses). This server stores nothing and logs no keys; listing the tools needs
 * no key, running one does.
 *
 * Deploy: deno deploy --org emaki --app emaki-mcp (entrypoint remote/main.ts)
 */

const SITE = 'https://emaki.ai';
const VERSION = '0.1.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
/** A tool call that blocks longer than this hands back a run id instead. */
const WAIT_MS = 50_000;
const POLL_MS = 5_000;

const VIDEO_MODELS = ['seedance_2_5', 'seedance_2', 'seedance_2_fast', 'seedance_2_mini', 'minimax_h3', 'veo_3_1'];
const IMAGE_MODELS = ['nano_banana_2_lite', 'nano_banana_2', 'seedream_5_lite', 'gpt_image_2'];

const KEY_HINT = 'Pass your emaki API key as "Authorization: Bearer sk-..." (create one at https://emaki.ai/settings/apikeys).';

const TOOLS = [
  {
    name: 'generate_video',
    title: 'Generate a video on emaki',
    description:
      'Generate a video clip from a text prompt on emaki.ai, or animate a still by passing image_url (image to video). Defaults to Seedance 2.5 (4 to 30 seconds, sound in the same pass). Runs on your emaki credits, the same price as on the website. Video takes minutes: this returns a run id to poll with check_status.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The shot: what happens, where, how the camera moves. Japanese or English.' },
        model: { type: 'string', enum: VIDEO_MODELS, description: 'Default seedance_2_5. seedance_2_mini is the lowest-cost video model.' },
        image_url: { type: 'string', description: 'Optional first frame (public https URL): makes this image to video.' },
        last_frame_image: { type: 'string', description: 'Optional last frame (https URL), Seedance 2.5 only.' },
        duration: { type: 'integer', description: 'Seconds. Seedance 2.5: 4-30; Seedance 2.0 family: 4-15; MiniMax H3: 5-15.' },
        resolution: { type: 'string', description: "'480p', '720p' or '1080p' (Veo 3.1: '720p', '1080p', '4k')." },
        aspect_ratio: { type: 'string', description: "'16:9', '9:16', '1:1', '4:3', '3:4', '21:9' or 'adaptive'. Default 16:9." },
        generate_audio: { type: 'boolean', description: 'Sound in the same pass where the model offers it (default true).' },
      },
      required: ['prompt'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'generate_image',
    title: 'Generate an image on emaki',
    description:
      'Generate an image from a text prompt on emaki.ai and return its URL. Defaults to Nano Banana 2 Lite, the lowest-cost model; a good way to make a first frame for generate_video. Runs on your emaki credits.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What the image should show.' },
        model: { type: 'string', enum: IMAGE_MODELS, description: 'Default nano_banana_2_lite.' },
        aspect_ratio: { type: 'string', description: "e.g. '1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'." },
        resolution: { type: 'string', description: "'1K', '2K' or '4K' (nano_banana_2 and gpt_image_2)." },
        quality: { type: 'string', description: "'basic', 'high' or 'ultra' (seedream_5_lite)." },
      },
      required: ['prompt'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'check_status',
    title: 'Check an emaki run',
    description: 'Read the status of a run started with generate_video or generate_image, and its URL when it is ready.',
    inputSchema: {
      type: 'object',
      properties: { run_id: { type: 'string', description: 'The run id returned by generate_video or generate_image.' } },
      required: ['run_id'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'credits',
    title: 'emaki credit balance',
    description: 'The credits left on the emaki account behind your API key. Free to call.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

class EmakiError extends Error {
  constructor(message: string, readonly kind: string) {
    super(message);
  }
}

type Run = { id: string; status: string; videoUrl?: string | null; failureCode?: string | null };

async function post(key: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  let res: Response;
  try {
    res = await fetch(`${SITE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'user-agent': `emaki-mcp-remote/${VERSION}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new EmakiError(`Could not reach emaki.ai: ${(e as Error).message}`, 'network');
  }
  const text = await res.text();
  try {
    return { status: res.status, json: text ? JSON.parse(text) : {} };
  } catch {
    throw new EmakiError(`emaki.ai returned a non-JSON response (HTTP ${res.status})`, 'server');
  }
}

function raise(status: number, json: any): never {
  const message: string = json?.error || json?.message || `request failed (HTTP ${status})`;
  const code: string | undefined = json?.code;
  if (status === 401) throw new EmakiError(message, 'auth');
  if (status === 402) throw new EmakiError(`${message}. Top up at https://emaki.ai/pricing`, 'quota');
  if (status === 403) throw new EmakiError(`${message}. This model needs a purchase on your emaki account: https://emaki.ai/pricing`, 'plan');
  if (status === 409) throw new EmakiError(`${message}. Wait for the current run to finish (check_status), then try again.`, 'busy');
  if (code === 'content_cooldown' || code === 'content_blocked') throw new EmakiError(message, 'rejected');
  throw new EmakiError(message, status < 500 ? 'validation' : 'server');
}

async function submit(key: string, prompt: string, model: string, parameters: Record<string, unknown>): Promise<Run> {
  const { status, json } = await post(key, '/api/video/ai', { prompt, model, parameters });
  if (status !== 200 || !json?.success || !json?.data?.id) raise(status, json);
  return json.data;
}

async function getStatus(key: string, id: string): Promise<Run> {
  const { status, json } = await post(key, '/api/video/status', { videoId: id });
  if (status !== 200 || !json?.success || !json?.data) raise(status, json);
  return json.data;
}

async function credits(key: string): Promise<number> {
  const { status, json } = await post(key, '/api/user/get-user-credits');
  // Refusals come back as HTTP 200 with code -1.
  if (status === 401 || json?.code !== 0) throw new EmakiError(json?.message || json?.error || `request failed (HTTP ${status})`, 'auth');
  return json.data.remainingCredits;
}

async function waitBriefly(key: string, run: Run): Promise<Run> {
  const deadline = Date.now() + WAIT_MS;
  while (run.status !== 'completed' && run.status !== 'failed' && Date.now() + POLL_MS < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    run = await getStatus(key, run.id);
  }
  return run;
}

function report(run: Run, label: string): string {
  if (run.status === 'completed' && run.videoUrl) return `${label} ready:\n\n${run.videoUrl}\n\nRun id: ${run.id}`;
  if (run.status === 'failed') return `${label} failed${run.failureCode ? ` (${run.failureCode})` : ''}. Run id: ${run.id}`;
  return `${label} is generating. Check it with check_status and this id: ${run.id}`;
}

const text = (body: string, isError = false) => ({ content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) });

function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

async function callTool(name: string, args: Record<string, any>, key: string | undefined) {
  if (!TOOLS.some((t) => t.name === name)) return text(`Unknown tool: ${name}`, true);
  if (!key) return text(`No API key. ${KEY_HINT}`, true);
  try {
    switch (name) {
      case 'credits':
        return text(`${await credits(key)} credits left on your emaki account. Top up at https://emaki.ai/pricing`);
      case 'check_status':
        if (!args.run_id) return text('run_id is required.', true);
        return text(report(await getStatus(key, String(args.run_id)), 'Run'));
      case 'generate_image': {
        if (!args.prompt) return text('prompt is required.', true);
        const model = IMAGE_MODELS.includes(args.model) ? args.model : 'nano_banana_2_lite';
        const run = await submit(key, String(args.prompt), model, compact({ aspect_ratio: args.aspect_ratio, resolution: args.resolution, quality: args.quality }));
        return text(report(await waitBriefly(key, run), 'Image'));
      }
      case 'generate_video': {
        if (!args.prompt) return text('prompt is required.', true);
        const model = VIDEO_MODELS.includes(args.model) ? args.model : 'seedance_2_5';
        const params = compact({
          image: args.image_url,
          last_frame_image: args.last_frame_image,
          duration: args.duration,
          resolution: args.resolution,
          generate_audio: args.generate_audio,
          // Veo 3.1 names this field in camelCase; every other model in snake_case.
          ...(model === 'veo_3_1' ? { aspectRatio: args.aspect_ratio } : { aspect_ratio: args.aspect_ratio }),
        });
        return text(report(await submit(key, String(args.prompt), model, params), 'Video'));
      }
    }
  } catch (e) {
    const err = e as EmakiError;
    const msg = err.kind === 'auth' && !err.message.includes('apikeys') ? `${err.message} ${KEY_HINT}` : err.message;
    return text(`${name} refused: ${msg}`, true);
  }
  return text(`Unknown tool: ${name}`, true);
}

function keyFrom(req: Request, url: URL): string | undefined {
  const auth = req.headers.get('authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  return bearer || req.headers.get('x-emaki-api-key')?.trim() || url.searchParams.get('apiKey')?.trim() || url.searchParams.get('api_key')?.trim() || undefined;
}

type RpcMessage = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any };

async function handle(msg: RpcMessage, key: string | undefined): Promise<object | null> {
  const isRequest = msg.id !== undefined && msg.id !== null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isRequest ? err(-32600, 'Invalid Request') : null;
  if (!isRequest) return null; // notifications/initialized and friends
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'emaki-mcp', title: 'emaki', version: VERSION, websiteUrl: SITE },
        instructions:
          'emaki runs Seedance 2.5, Seedance 2.0 and other video and image models on the user\'s own emaki.ai credits. Video takes minutes: generate_video returns a run id, poll it with check_status.',
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call':
      return ok(await callTool(msg.params?.name, msg.params?.arguments ?? {}, key));
    case 'resources/list':
      return ok({ resources: [] });
    case 'prompts/list':
      return ok({ prompts: [] });
    default:
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version, x-emaki-api-key',
  'access-control-expose-headers': 'mcp-session-id',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

const CONFIG_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://emaki-mcp.emaki.deno.net/.well-known/mcp-config',
  title: 'emaki MCP session configuration',
  description: 'Your emaki API key. Create one at https://emaki.ai/settings/apikeys.',
  'x-query-style': 'dot+bracket',
  type: 'object',
  properties: { apiKey: { type: 'string', title: 'emaki API key', description: 'sk-... from https://emaki.ai/settings/apikeys' } },
  required: [],
};

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>emaki remote MCP server: Seedance 2.5 video from any MCP client</title>
<meta name="description" content="Remote MCP endpoint for emaki (emaki.ai): generate Seedance 2.5 and Seedance 2.0 video and AI images from Claude, Cursor or any MCP client on your own API key.">
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#222}code,pre{background:#f4f4f4;border-radius:6px}pre{padding:12px;overflow:auto}code{padding:2px 5px}</style>
</head><body>
<h1>emaki remote MCP server</h1>
<p>Official remote MCP endpoint for <a href="https://emaki.ai/">emaki</a>, the Japanese-language AI video generator for <a href="https://emaki.ai/seedance-2-5">Seedance 2.5</a> and <a href="https://emaki.ai/seedance-2">Seedance 2.0</a>. Point any MCP client that speaks Streamable HTTP at the URL below and ask for a clip in chat.</p>
<pre>https://emaki-mcp.emaki.deno.net/mcp</pre>
<p>Send your own key with every request: <code>Authorization: Bearer sk-...</code>. Create one at <a href="https://emaki.ai/settings/apikeys">emaki.ai/settings/apikeys</a>. Runs cost credits on your emaki account, the same price as on the website. This server keeps nothing.</p>
<pre>claude mcp add --transport http emaki https://emaki-mcp.emaki.deno.net/mcp --header "Authorization: Bearer sk-..."</pre>
<h2>Tools</h2>
<ul><li><code>generate_video</code>: text to video, or <a href="https://emaki.ai/image-to-video">image to video</a> with <code>image_url</code></li>
<li><code>generate_image</code>: text to image (Nano Banana 2, Seedream 5, GPT Image 2)</li>
<li><code>check_status</code>: status and URL of a run</li><li><code>credits</code>: credits left (free)</li></ul>
<p>Prefer a local process? <code>npx -y emaki-mcp</code>. Source: <a href="https://github.com/hanshs474/emaki-mcp">github.com/hanshs474/emaki-mcp</a>. Need a sharper clip afterwards? Try the <a href="https://emaki.ai/video-upscaler">AI video upscaler</a>.</p>
<p lang="ja">日本語での使い方は <a href="https://emaki.ai/">シーダンス</a> へ。</p>
</body></html>`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/.well-known/mcp-config') return json(CONFIG_SCHEMA);
  if (url.pathname === '/' && req.method === 'GET') {
    return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  if (url.pathname !== '/mcp' && url.pathname !== '/') return json({ error: 'Not found. The MCP endpoint is /mcp' }, 404);
  if (req.method === 'GET') return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed: this server is stateless, POST JSON-RPC to /mcp' } }, 405);
  if (req.method === 'DELETE') return new Response(null, { status: 405, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  const key = keyFrom(req, url);
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, key)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handle(body as RpcMessage, key);
  return out ? json(out) : new Response(null, { status: 202, headers: CORS });
});
