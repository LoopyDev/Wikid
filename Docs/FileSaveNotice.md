# File Save Payload Notice

We raised the API JSON body size limit to 10mb to avoid "PayloadTooLargeError"
when saving page content. This is a stopgap.

We still need to investigate why normal typing can exceed the limit. The save
endpoint currently sends the full document JSON on each save. Possible causes:
- The document JSON is already large (embedded base64 images, large tables).
- A bug is duplicating content on each change.
- Payload size grows due to repeated blocks or metadata.

Next steps:
- Inspect `/pages/:id/content` payload size in the browser network panel.
- Identify oversized fields or repeated content in the payload.
- Consider incremental/patch saves or server-side compression.
