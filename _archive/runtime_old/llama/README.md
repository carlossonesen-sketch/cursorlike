# Local LLM runtime (llama.cpp)

Place **llama-server.exe** (Windows) here for the local provider.

- Download or build from [llama.cpp](https://github.com/ggerganov/llama.cpp).
- The app looks for `llama-server.exe` in this folder when using Provider **Local (llama.cpp)**.
- You can also set a custom path to the binary via the GGUF model path or a future settings option; the app will otherwise use `runtime/llama/llama-server.exe` relative to the executable or current working directory.
