/**
 * emaki-mcp — run emaki's video and image models (Seedance 2.5, Seedance 2.0,
 * Nano Banana 2 and more) from any MCP client.
 *
 * Every tool goes through emaki.ai's public API with the caller's own key, so a
 * run costs the same credits and lands in the same library as a run made on
 * the website.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { credits, credentialsHint, EmakiError, getStatus, hasApiKey, submit, waitFor, type Run } from './client.js';

export const VIDEO_MODELS = [
  'seedance_2_5',
  'seedance_2',
  'seedance_2_fast',
  'seedance_2_mini',
  'minimax_h3',
  'veo_3_1',
] as const;
export const IMAGE_MODELS = ['nano_banana_2_lite', 'nano_banana_2', 'seedream_5_lite', 'gpt_image_2'] as const;

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] });
const fail = (body: string) => ({ ...text(body), isError: true as const });

function explain(e: unknown): string {
  if (!(e instanceof EmakiError)) return String(e);
  switch (e.kind) {
    case 'auth':
      return `${e.message}${e.message.includes('apikeys') ? '' : ` ${credentialsHint}`}`;
    case 'quota':
      return `${e.message}. Top up at https://emaki.ai/pricing`;
    case 'plan':
      return `${e.message}. This model needs a purchase on your emaki account: https://emaki.ai/pricing`;
    case 'busy':
      return `${e.message}. Wait for the current run to finish (check_status), then try again.`;
    default:
      return e.message;
  }
}

function report(run: Run, label: string): string {
  if (run.status === 'completed' && run.videoUrl) return `${label} ready:\n\n${run.videoUrl}\n\nRun id: ${run.id}`;
  if (run.status === 'failed') {
    return `${label} failed${run.failureCode ? ` (${run.failureCode})` : ''}. Run id: ${run.id}`;
  }
  return `${label} is generating. Check it with check_status and this id: ${run.id}`;
}

async function start(
  label: string,
  prompt: string,
  model: string,
  parameters: Record<string, unknown>,
  wait: boolean
) {
  if (!hasApiKey()) return fail(`No API key set. ${credentialsHint}`);
  try {
    const run = await submit(prompt, model, parameters);
    if (!wait) return text(report(run, label));
    return text(report(await waitFor(run.id), label));
  } catch (e) {
    return fail(`${label} refused: ${explain(e)}`);
  }
}

/** Drop undefined so the API applies its own defaults. */
function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'emaki-mcp', version: '0.1.0' });

  server.registerTool(
    'generate_video',
    {
      title: 'Generate a video on emaki',
      description:
        'Generate a video clip from a text prompt on emaki.ai, or animate a still by passing image_url (image to video). Defaults to Seedance 2.5 (4 to 30 seconds, sound in the same pass). Runs on your emaki credits, the same price as on the website. Video takes minutes: by default this returns a run id to poll with check_status.',
      inputSchema: {
        prompt: z.string().describe('The shot: what happens, where, how the camera moves. Japanese or English.'),
        model: z
          .enum(VIDEO_MODELS)
          .optional()
          .describe('Default seedance_2_5. seedance_2_mini is the lowest-cost video model.'),
        image_url: z.string().optional().describe('Optional first frame (public https URL) — makes this image to video.'),
        last_frame_image: z.string().optional().describe('Optional last frame (https URL), Seedance 2.5 only.'),
        duration: z
          .number()
          .int()
          .optional()
          .describe('Seconds. Seedance 2.5: 4–30; Seedance 2.0 family: 4–15; MiniMax H3: 5–15.'),
        resolution: z.string().optional().describe("'480p', '720p' or '1080p' (Veo 3.1: '720p', '1080p', '4k')."),
        aspect_ratio: z
          .string()
          .optional()
          .describe("'16:9', '9:16', '1:1', '4:3', '3:4', '21:9' or 'adaptive'. Default 16:9."),
        generate_audio: z.boolean().optional().describe('Sound in the same pass where the model offers it (default true).'),
        wait: z.boolean().optional().describe('Block until the clip is ready (up to 15 minutes). Default false.'),
      },
    },
    async ({ prompt, model, image_url, last_frame_image, duration, resolution, aspect_ratio, generate_audio, wait = false }) => {
      const id = model ?? 'seedance_2_5';
      const params = compact({
        image: image_url,
        last_frame_image,
        duration,
        resolution,
        generate_audio,
        // Veo 3.1 names this field in camelCase; every other model in snake_case.
        ...(id === 'veo_3_1' ? { aspectRatio: aspect_ratio } : { aspect_ratio }),
      });
      return start('Video', prompt, id, params, wait);
    }
  );

  server.registerTool(
    'generate_image',
    {
      title: 'Generate an image on emaki',
      description:
        'Generate an image from a text prompt on emaki.ai and return its URL. Defaults to Nano Banana 2 Lite, the lowest-cost model; a good way to make a first frame for generate_video. Runs on your emaki credits.',
      inputSchema: {
        prompt: z.string().describe('What the image should show.'),
        model: z.enum(IMAGE_MODELS).optional().describe('Default nano_banana_2_lite.'),
        aspect_ratio: z.string().optional().describe("e.g. '1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'."),
        resolution: z.string().optional().describe("'1K', '2K' or '4K' (nano_banana_2 and gpt_image_2)."),
        quality: z.string().optional().describe("'basic', 'high' or 'ultra' (seedream_5_lite)."),
        wait: z.boolean().optional().describe('Block until the image is ready. Default true.'),
      },
    },
    async ({ prompt, model, aspect_ratio, resolution, quality, wait = true }) =>
      start('Image', prompt, model ?? 'nano_banana_2_lite', compact({ aspect_ratio, resolution, quality }), wait)
  );

  server.registerTool(
    'check_status',
    {
      title: 'Check an emaki run',
      description: 'Read the status of a run started with generate_video or generate_image, and its URL when it is ready.',
      inputSchema: {
        run_id: z.string().describe('The run id returned by generate_video or generate_image.'),
        wait: z.boolean().optional().describe('Keep polling every 5 seconds until it finishes. Default false.'),
      },
    },
    async ({ run_id, wait = false }) => {
      if (!hasApiKey()) return fail(`No API key set. ${credentialsHint}`);
      try {
        const run = wait ? await waitFor(run_id) : await getStatus(run_id);
        return text(report(run, 'Run'));
      } catch (e) {
        return fail(`Could not read run ${run_id}: ${explain(e)}`);
      }
    }
  );

  server.registerTool(
    'credits',
    {
      title: 'emaki credit balance',
      description: 'The credits left on the emaki account behind EMAKI_API_KEY. Free to call.',
      inputSchema: {},
    },
    async () => {
      if (!hasApiKey()) return fail(`No API key set. ${credentialsHint}`);
      try {
        const c = await credits();
        return text(`${c.remainingCredits} credits left on your emaki account. Top up at https://emaki.ai/pricing`);
      } catch (e) {
        return fail(`Could not read credits: ${explain(e)}`);
      }
    }
  );

  return server;
}

