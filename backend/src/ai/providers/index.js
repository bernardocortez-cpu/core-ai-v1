const openai = require("./openai");
const gemini = require("./gemini");
const anthropic = require("./anthropic");
const grok = require("./grok");
const flux = require("./flux");
const ideogram = require("./ideogram");
const seedream = require("./seedream");
const seedance = require("./seedance");
const deepseek = require("./deepseek");
const moonshot = require("./moonshot");
const perplexity = require("./perplexity");
const qwen = require("./qwen");
const openrouter = require("./openrouter");
const atlascloud = require("./atlascloud");

const PROVIDERS = {
  openai,
  gemini,
  anthropic,
  grok,
  flux,
  ideogram,
  seedream,
  seedance,
  deepseek,
  moonshot,
  perplexity,
  qwen,
  openrouter,
  atlascloud,
  // Future providers can be added here with the same interface:
  // streamChat({ remoteModel, messages, onDelta, signal })
};

function getProvider(provider) {
  return PROVIDERS[String(provider || "")] || null;
}

module.exports = { getProvider };
