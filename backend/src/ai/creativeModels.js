// Creative Studio model registry (images/videos/music).
//
// Keep this list aligned with the frontend CreativeStudio model picker.
// We can progressively implement providers; unimplemented models will return 501.

const MODELS = [
  // OpenAI images
  {
    id: "gpt-image-1.5",
    type: "image",
    provider: "openai",
    // Default to the official model id; if the project doesn't have access,
    // creative.service.js will automatically fall back (e.g. to gpt-image-1 / DALL·E).
    remoteModel: process.env.OPENAI_GPT_IMAGE_15_REMOTE_MODEL || "gpt-image-1.5",
    implemented: true,
  },
  {
    id: "gpt-image-1",
    type: "image",
    provider: "openai",
    remoteModel: process.env.OPENAI_GPT_IMAGE_1_REMOTE_MODEL || "gpt-image-1",
    implemented: true,
  },

  // Stubs (future providers)
  // Google (Gemini API / Imagen via OpenAI-compat endpoint)
  {
    id: "nano-banana-2",
    type: "image",
    provider: "gemini",
    // New default (Google "Nano Banana 2"). Supports image editing (img2img).
    // Official model id (Gemini API): gemini-3.1-flash-image-preview
    remoteModel:
      process.env.GEMINI_NANO_BANANA_2_REMOTE_MODEL || "gemini-3.1-flash-image-preview",
    implemented: true,
  },
  {
    id: "nano-banana-pro",
    type: "image",
    provider: "gemini",
    // Best quality (Google "Nano Banana Pro"). Supports image editing (img2img).
    remoteModel: process.env.GEMINI_NANO_BANANA_PRO_REMOTE_MODEL || "gemini-3-pro-image-preview",
    implemented: true,
  },
  {
    id: "nano-banana",
    type: "image",
    provider: "gemini",
    // Fast/cheap default (Google "Nano Banana"). Supports image editing (img2img).
    remoteModel: process.env.GEMINI_NANO_BANANA_REMOTE_MODEL || "gemini-2.5-flash-image",
    implemented: true,
  },
  {
    id: "flux-2-pro",
    type: "image",
    provider: "flux",
    remoteModel: process.env.FLUX_2_PRO_REMOTE_MODEL || "flux-2-pro",
    implemented: true,
  },
  {
    id: "flux-2",
    type: "image",
    provider: "flux",
    // BFL uses explicit endpoint ids; "flux-2" is a friendly UI label.
    remoteModel: process.env.FLUX_2_REMOTE_MODEL || "flux-2-flex",
    implemented: true,
  },
  {
    id: "ideogram-3",
    type: "image",
    provider: "ideogram",
    remoteModel: process.env.IDEOGRAM_3_REMOTE_MODEL || "ideogram-3",
    implemented: true,
  },
  {
    id: "seedream-5-lite",
    type: "image",
    provider: "seedream",
    // Prefer the canonical ModelArk id used in console/docs. The explicit lite alias
    // still exists, but some projects appear to expose access through the canonical id.
    remoteModel: process.env.SEEDREAM_5_LITE_REMOTE_MODEL || "seedream-5-0-260128",
    implemented: true,
  },
  {
    id: "seedream-4.5",
    type: "image",
    provider: "seedream",
    // ModelArk model id (can be overridden via SEEDREAM_45_REMOTE_MODEL).
    remoteModel: process.env.SEEDREAM_45_REMOTE_MODEL || "seedream-4-5-251128",
    implemented: true,
  },
  // xAI (OpenAI-compatible images endpoint)
  {
    id: "grok-image",
    type: "image",
    provider: "grok",
    remoteModel: process.env.GROK_IMAGE_REMOTE_MODEL || "grok-imagine-image",
    implemented: true,
  },
  // Video
  {
    id: "seedance-2",
    type: "video",
    provider: "seedance",
    remoteModel: process.env.SEEDANCE_2_REMOTE_MODEL || "seedance-1-5-pro-251215",
    implemented: true,
  },
  {
    id: "veo-3.1",
    type: "video",
    provider: "gemini",
    remoteModel: process.env.GEMINI_VEO_31_REMOTE_MODEL || "veo-3.1-generate-preview",
    implemented: true,
  },
  {
    id: "hailuo-2.3",
    type: "video",
    provider: "atlascloud",
    remoteModel:
      process.env.ATLASCLOUD_HAILUO_23_TEXT_REMOTE_MODEL ||
      process.env.ATLASCLOUD_HAILUO_23_REMOTE_MODEL ||
      "minimax/hailuo-2.3/t2v-standard",
    remoteByMode: {
      text:
        process.env.ATLASCLOUD_HAILUO_23_TEXT_REMOTE_MODEL ||
        process.env.ATLASCLOUD_HAILUO_23_REMOTE_MODEL ||
        "minimax/hailuo-2.3/t2v-standard",
      image:
        process.env.ATLASCLOUD_HAILUO_23_IMAGE_REMOTE_MODEL ||
        process.env.ATLASCLOUD_HAILUO_23_REMOTE_MODEL ||
        "minimax/hailuo-2.3/i2v-standard",
    },
    implemented: true,
  },
  {
    id: "wan-2.6",
    type: "video",
    provider: "atlascloud",
    remoteModel:
      process.env.ATLASCLOUD_WAN_26_TEXT_REMOTE_MODEL ||
      process.env.ATLASCLOUD_WAN_26_REMOTE_MODEL ||
      "alibaba/wan-2.6/text-to-video",
    remoteByMode: {
      text:
        process.env.ATLASCLOUD_WAN_26_TEXT_REMOTE_MODEL ||
        process.env.ATLASCLOUD_WAN_26_REMOTE_MODEL ||
        "alibaba/wan-2.6/text-to-video",
      image:
        process.env.ATLASCLOUD_WAN_26_IMAGE_REMOTE_MODEL ||
        process.env.ATLASCLOUD_WAN_26_REMOTE_MODEL ||
        "alibaba/wan-2.6/image-to-video",
    },
    implemented: true,
  },
  {
    id: "kling-3",
    type: "video",
    provider: "atlascloud",
    remoteModel:
      process.env.ATLASCLOUD_KLING_3_TEXT_REMOTE_MODEL ||
      process.env.ATLASCLOUD_KLING_3_REMOTE_MODEL ||
      "kwaivgi/kling-v3.0-std/text-to-video",
    remoteByMode: {
      text:
        process.env.ATLASCLOUD_KLING_3_TEXT_REMOTE_MODEL ||
        process.env.ATLASCLOUD_KLING_3_REMOTE_MODEL ||
        "kwaivgi/kling-v3.0-std/text-to-video",
      image:
        process.env.ATLASCLOUD_KLING_3_IMAGE_REMOTE_MODEL ||
        process.env.ATLASCLOUD_KLING_3_REMOTE_MODEL ||
        "kwaivgi/kling-v3.0-std/image-to-video",
    },
    implemented: true,
  },
  {
    id: "vidu-q3",
    type: "video",
    provider: "atlascloud",
    remoteModel:
      process.env.ATLASCLOUD_VIDU_Q3_TEXT_REMOTE_MODEL ||
      process.env.ATLASCLOUD_VIDU_Q3_REMOTE_MODEL ||
      "vidu/q3/text-to-video",
    remoteByMode: {
      text:
        process.env.ATLASCLOUD_VIDU_Q3_TEXT_REMOTE_MODEL ||
        process.env.ATLASCLOUD_VIDU_Q3_REMOTE_MODEL ||
        "vidu/q3/text-to-video",
      image:
        process.env.ATLASCLOUD_VIDU_Q3_IMAGE_REMOTE_MODEL ||
        process.env.ATLASCLOUD_VIDU_Q3_REMOTE_MODEL ||
        "vidu/q3/image-to-video",
      video:
        process.env.ATLASCLOUD_VIDU_Q3_VIDEO_REMOTE_MODEL ||
        process.env.ATLASCLOUD_VIDU_Q3_REMOTE_MODEL ||
        "vidu/q3/reference-to-video",
    },
    implemented: true,
  },
  {
    id: "eleven-multilingual-v2",
    type: "voice",
    provider: "elevenlabs",
    remoteModel: process.env.ELEVEN_MULTILINGUAL_V2_REMOTE_MODEL || "eleven-multilingual-v2",
    implemented: false,
  },
  {
    id: "minimax-02-hd",
    type: "voice",
    provider: "minimax",
    remoteModel: process.env.MINIMAX_02_HD_REMOTE_MODEL || "minimax-02-hd",
    implemented: false,
  },
  {
    id: "cartesia-sonic-2",
    type: "voice",
    provider: "cartesia",
    remoteModel: process.env.CARTESIA_SONIC_2_REMOTE_MODEL || "cartesia-sonic-2",
    implemented: false,
  },
  {
    id: "eleven-v3",
    type: "voice",
    provider: "elevenlabs",
    remoteModel: process.env.ELEVEN_V3_REMOTE_MODEL || "eleven-v3",
    implemented: false,
  },
  {
    id: "lyria-3",
    type: "music",
    provider: "gemini",
    remoteModel: process.env.GEMINI_LYRIA_3_REMOTE_MODEL || "lyria-3-clip-preview",
    implemented: true,
  },
  {
    id: "lyria-3-pro",
    type: "music",
    provider: "gemini",
    remoteModel: process.env.GEMINI_LYRIA_3_PRO_REMOTE_MODEL || "lyria-3-pro-preview",
    implemented: true,
  },
  {
    id: "suno-v5.5",
    type: "music",
    provider: "suno",
    remoteModel: process.env.SUNO_V55_REMOTE_MODEL || "suno-v5.5",
    implemented: false,
  },
];

const MODEL_BY_ID = new Map(MODELS.map((m) => [String(m.id).toLowerCase(), m]));
const MODEL_ID_ALIASES = new Map([
  ["runway-gen-4.5", "vidu-q3"],
]);

function getCreativeModel(id) {
  const key = String(id || "").trim().toLowerCase();
  const resolved = MODEL_ID_ALIASES.get(key) || key;
  return MODEL_BY_ID.get(resolved) || null;
}

function listCreativeModels() {
  return MODELS.slice();
}

module.exports = {
  getCreativeModel,
  listCreativeModels,
};
