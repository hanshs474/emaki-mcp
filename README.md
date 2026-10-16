# emaki MCP server

Official MCP server for emaki (emaki.ai), the Japanese-language AI video generator for Seedance 2.5 and Seedance 2.0. It lets Claude, Cursor, Cline, Gemini CLI or any MCP client generate video and images on your own emaki account: ask for a clip in chat, get the file URL back.

- [Seedance 2.5](https://emaki.ai/seedance-2-5) is the default video model: 4 to 30 seconds, up to 1080p, sound in the same pass.
- [Seedance 2.0](https://emaki.ai/seedance-2), Seedance 2.0 Fast and Mini, MiniMax H3 and Veo 3.1 are there too.
- Pass a still as `image_url` for [image to video](https://emaki.ai/image-to-video); the image tools (Nano Banana 2, Seedream 5, GPT Image 2) make that first frame.
- Need a sharper result afterwards? The [AI video upscaler](https://emaki.ai/video-upscaler) runs on the same account.

日本語での使い方は [シーダンス](https://emaki.ai/) へ。

## Tools

| Tool | What it does |
|---|---|
| `generate_video` | Text to video, or image to video with `image_url`. Returns a run id (or waits with `wait: true`) |
| `generate_image` | Text to image; returns the image URL |
| `check_status` | Status of a run, and its URL when it is ready |
| `credits` | Credits left on your account (free to call) |

## API key

Create one at [emaki.ai/settings/apikeys](https://emaki.ai/settings/apikeys) and set it as `EMAKI_API_KEY`. Every run costs credits on your emaki account, the same price as on the website.

## Install

```bash
npx -y emaki-mcp
```

### Claude Desktop / Claude Code / Cursor / Cline

```json
{
  "mcpServers": {
    "emaki": {
      "command": "npx",
      "args": ["-y", "emaki-mcp"],
      "env": { "EMAKI_API_KEY": "sk-..." }
    }
  }
}
```

Claude Code in one line: `claude mcp add emaki -e EMAKI_API_KEY=sk-... -- npx -y emaki-mcp`

### Gemini CLI

```bash
gemini extensions install https://github.com/hanshs474/emaki-mcp
```

### Claude Code plugin

```bash
claude plugin marketplace add hanshs474/emaki-mcp
claude plugin install emaki@emaki
```

## Models

| Video (`generate_video`) | Image (`generate_image`) |
|---|---|
| `seedance_2_5` (default) · `seedance_2` · `seedance_2_fast` · `seedance_2_mini` · `minimax_h3` · `veo_3_1` | `nano_banana_2_lite` (default) · `nano_banana_2` · `seedream_5_lite` · `gpt_image_2` |

Parameters: `duration`, `resolution` (`480p` / `720p` / `1080p`), `aspect_ratio` (`16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`, `adaptive`), `generate_audio`, `image_url`, `last_frame_image`.

## Notes

- Video takes minutes. `generate_video` returns a run id by default; poll it with `check_status`, or pass `wait: true` to block (up to 15 minutes).
- One video runs at a time per account; a second submit while one is generating is refused until the first finishes.
- `EMAKI_BASE_URL` overrides the endpoint; only useful against a local build of the site.

API reference: [emaki.readthedocs.io](https://emaki.readthedocs.io/). MIT licensed. Made by [emaki](https://emaki.ai/?utm_source=github&utm_medium=package).
