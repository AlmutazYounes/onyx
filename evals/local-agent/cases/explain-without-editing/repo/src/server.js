import { loadConfig } from "./config.js";

const config = loadConfig();
console.log(`listening on ${config.port} with ${config.retries} retries`);
