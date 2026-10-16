---
name: emaki-video
description: Generate a video clip (Seedance 2.5, Seedance 2.0) or an image on emaki.ai with the user's own API key. Use when the user asks for a video, an animated version of a still (image to video), a short clip with sound, or a first-frame image, and EMAKI_API_KEY is set.
---

# emaki video

[emaki](https://emaki.ai/?utm_source=agent-plugin&utm_medium=skill) runs [Seedance 2.5](https://emaki.ai/seedance-2-5) and [Seedance 2.0](https://emaki.ai/seedance-2) behind one API key. The MCP server in this repo (`npx -y emaki-mcp`) wraps the calls below as tools; use this page when you are calling the HTTP API directly.

Every call needs `Authorization: Bearer $EMAKI_API_KEY` (create a key at https://emaki.ai/settings/apikeys). Runs cost credits on the user's emaki account, the same price as on the website.

## 1. Check the balance (free)

```bash
curl -s -X POST https://emaki.ai/api/user/get-user-credits -H "Authorization: Bearer $EMAKI_API_KEY"
# {"code":0,"data":{"remainingCredits":120,"hasPurchasedCredits":true}}
```

## 2. Submit

```bash
curl -s -X POST https://emaki.ai/api/video/ai \
  -H "Authorization: Bearer $EMAKI_API_KEY" -H "content-type: application/json" \
  -d '{"prompt":"a paper boat drifting on a calm lake at sunrise, slow dolly in",
       "model":"seedance_2_5",
       "parameters":{"duration":5,"resolution":"480p","aspect_ratio":"16:9"}}'
# {"success":true,"data":{"id":"<videoId>","status":"generating"}}
```

For [image to video](https://emaki.ai/image-to-video) add `"image": "https://…/first-frame.png"` to `parameters`. For an image, use `"model":"nano_banana_2_lite"` (the lowest-cost model).

## 3. Poll every 5 seconds

```bash
curl -s -X POST https://emaki.ai/api/video/status \
  -H "Authorization: Bearer $EMAKI_API_KEY" -H "content-type: application/json" \
  -d '{"videoId":"<videoId>"}'
# {"success":true,"data":{"status":"completed","videoUrl":"https://…"}}
```

`status` is `generating`, `completed` (the result URL is in `videoUrl`, images included) or `failed` (see `failureCode`).

## Errors

| HTTP | Meaning |
|---|---|
| 401 | No key or an invalid key |
| 402 | Not enough credits |
| 403 | This model needs a purchase on the account |
| 409 | A video is already generating on this account; wait for it |
| 429 `content_cooldown` / 400 `content_blocked` | The prompt was refused |

日本語での使い方は [シーダンス](https://emaki.ai/) へ。
