function asNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function get(obj, path) {
  try {
    let cur = obj;
    for (const k of path) {
      if (!cur || typeof cur !== "object") return undefined;
      cur = cur[k];
    }
    return cur;
  } catch {
    return undefined;
  }
}

function getPromptCacheMetrics(usage) {
  const u = usage && typeof usage === "object" ? usage : null;
  if (!u) return null;

  const promptTokens = asNumber(u.prompt_tokens);
  const totalTokens = asNumber(u.total_tokens);

  // DeepSeek (OpenAI-compatible) commonly returns these at top-level.
  const deepseekHit = asNumber(u.prompt_cache_hit_tokens);
  const deepseekMiss = asNumber(u.prompt_cache_miss_tokens);

  // OpenAI returns cached tokens under prompt_tokens_details.
  const openaiCached = asNumber(get(u, ["prompt_tokens_details", "cached_tokens"]));

  // Anthropic returns cache fields inside its usage object; we also surface them at top-level in our adapter.
  const anthropicRead = asNumber(u.cache_read_input_tokens);
  const anthropicCreate = asNumber(u.cache_creation_input_tokens);

  // Gemini usageMetadata can include cachedContentTokenCount (implicit caching).
  const geminiCached = asNumber(u.cachedContentTokenCount) ?? asNumber(get(u, ["gemini", "cachedContentTokenCount"]));

  const hitTokens =
    deepseekHit ?? openaiCached ?? anthropicRead ?? geminiCached ?? null;
  const missTokens = deepseekMiss ?? null;

  if (hitTokens == null && missTokens == null && anthropicCreate == null) return null;

  // Denominator for hit% varies by provider:
  // - DeepSeek: hit + miss is the full prompt tokens.
  // - OpenAI: prompt_tokens already includes cached tokens (cached_tokens is a subset).
  // - Anthropic: input_tokens excludes cache_read_input_tokens, so denom is input + cache_read.
  const denom =
    hitTokens != null && missTokens != null
      ? hitTokens + missTokens
      : anthropicRead != null && promptTokens != null
        ? anthropicRead + promptTokens
        : promptTokens ?? null;
  const hitPct =
    denom && hitTokens != null && denom > 0 ? Math.round((hitTokens / denom) * 1000) / 10 : null;

  return {
    promptTokens: promptTokens ?? null,
    totalTokens: totalTokens ?? null,
    hitTokens: hitTokens ?? null,
    missTokens: missTokens ?? null,
    hitPct,
    cacheWriteTokens: anthropicCreate ?? null,
  };
}

module.exports = {
  getPromptCacheMetrics,
};
