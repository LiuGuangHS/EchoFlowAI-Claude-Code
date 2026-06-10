export const GENERATE_IMAGE_TOOL_NAME = 'GenerateImage'

export const DESCRIPTION = `Generate one or more image artifacts from a text prompt using the configured image generation provider.

Use this when the user asks you to create, render, generate, or draft an image asset. Generated files are written under the current workspace's .echoflow/artifacts directory for the active session, and the result includes Markdown image paths you can show to the user.`

export const PROMPT = `Generates image artifacts from a text prompt through the configured provider image generation capability.

The tool writes files into the current workspace artifact directory for the active session and returns Markdown paths like:
![Generated image 1](.echoflow/artifacts/<session>/<artifact>/image-1.png)

Do not pass filesystem paths. The tool derives the session and workspace from runtime context.`
