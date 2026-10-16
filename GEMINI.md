# emaki

This extension adds emaki's video and image models as tools: `generate_video`, `generate_image`, `check_status`, `credits`.

- It needs `EMAKI_API_KEY` in the environment (create one at https://emaki.ai/settings/apikeys). If a tool says no key is set, tell the user that, with the link.
- Video takes minutes: `generate_video` returns a run id; call `check_status` later rather than waiting in a loop.
- `seedance_2_5` is the default video model (4 to 30 seconds). Pass `image_url` to animate a still.
- Call `credits` before a long batch; it is free.
