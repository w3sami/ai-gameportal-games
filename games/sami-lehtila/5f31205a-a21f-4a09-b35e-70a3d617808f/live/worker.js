// WebLLM ajetaan workerissa, jotta mallin lataus ja generointi eivät jäädytä sivua.
import { WebWorkerMLCEngineHandler } from "https://esm.run/@mlc-ai/web-llm@0.2.84";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
