// frontend/src/CreativeStudio.jsx
import { useMemo, useState, useEffect, useRef } from "react";
import "./CreativeStudio.css";
import { useLocation } from "react-router-dom";
import { api, apiGetBlob } from "./services/api";
import useFileDropTarget, { extractTransferFiles } from "./hooks/useFileDropTarget";
import ComposerFileDropOverlay from "./components/composer/ComposerFileDropOverlay";

const CREATIVE_INSPIRATION = [
  {
    id: "Vintage-Car",
    prompt: "Hyper-realistic photograph of a classic 1973 petrol blue Porsche 911, paintwork with perfect reflections showing clouds and trees, impeccable gleaming chrome, detail of every screw and line of the iconic design. Parked on a winding mountain road at dawn, wet asphalt reflecting the car, hazy mountains blurred in the background. Golden side light highlighting the car's curves, dewdrops on the bodywork. 50mm f/2.8 lens, medium depth of field, rich cinematic colors, 8K quality, every metallic detail sharp, timeless elegance.",
    image: "/creative/Vintage-car.jpg",
    size: "large",
  },
  {
    id: "golden-retriever",
    prompt: "Hyper-realistic photograph of an adult Golden Retriever with a cheerful expression and tongue out, bright brown eyes full of life, golden fur fluttering in the wind with visible individual texture, ears perked up in happy alertness. Running in a field of colorful wildflowers, paws slightly off the ground capturing movement, crystal-clear drops of saliva in the air. Side golden hour light creating a golden halo on the coat, vibrant green blurred background, 85mm f/1.4 lens, fast shutter speed freezing action, creamy bokeh, 8K quality, every hair strand sharp, pure energy and canine joy.",
    image: "/creative/golden-retriever.jpg",
    size: "small",
  },
  {
    id: "northern-lights",
    prompt: "Hyper-realistic photograph of emerald green and purple aurora borealis dancing in the arctic sky, curtains of light undulating with ethereal details, Milky Way stars visible in the background, perfect reflection of the lights on a mirrored frozen lake below. Snow-capped mountains in silhouette, snow-covered pine trees in the foreground with visible ice crystals. Deeply dark night sky contrasting with vibrant lights. 14mm f/2.8 wide-angle lens, long exposure capturing subtle movement, intense natural colors, 8K quality, epic natural majesty, Nat Geo style.",
    image: "/creative/northern-lights.jpg",
    size: "small",
  },
  {
    id: "old-bookstore",
    prompt: "Hyper-realistic photograph of a vintage bookstore interior, dark wood shelves from floor to ceiling filled with antique books with worn leather spines in shades of brown, green, and red. Leaning wooden ladder, golden dust floating in the rays of light entering through a side window, aged wood texture with scratches and marks of time. Worn brown leather armchair, stack of open books showing yellowed pages with vintage typography. 35mm f/1.8 lens, atmospheric depth, warm Rembrandt lighting, sepia and gold tones, 8K quality, literary nostalgia, quiet and contemplative atmosphere.",
    image: "/creative/old-bookstore.jpg",
    size: "medium",
  },
  {
    id: "photograph-of-a-couple",
    prompt: "Create a realistic lifestyle photograph of a couple jogging on the beach at sunset, controlled warm flare, backlighting with hair clipping, sand rising, natural smiles, light clothing with an earthy palette. 35mm f1.8 lens, f2.2 aperture, 1/1000 shutter speed to freeze, ISO 200, WB 6000K. Fill light with gold reflector, horizon in the upper third, composition with sea trailing lines, soft bokeh. Warm Kodak Gold-type gradation, light grain, organic sharpness. 8k resolution, 3:2 aspect ratio.",
    image: "/creative/photograph-of-a-couple.jpg",
    size: "medium",
  },
  {
    id: "tropical beach",
    prompt: "Hyper-realistic photograph of a tropical beach at sunset, waves gently breaking on golden sand with detailed texture of each grain, crystal-clear white foam, translucent turquoise water revealing sand below. Dramatic sky with vibrant orange, pink, and purple clouds reflecting on the wet water. Palm trees silhouetted on the left, shells and small stones with sharp details in the foreground. 24mm f/8 wide-angle lens for full depth of field, vibrant saturated colors, 8K quality, every detail sharp, paradisiacal and serene atmosphere.",
    image: "/creative/tropical-beach.jpg",
    size: "large",
  },
];

const IconCopy = ({ className = "", ...p }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`action-copy-icon ${className}`.trim()}
    aria-hidden="true"
    {...p}
  >
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

const IconEdit = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
    <path d="M12 20h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path
      d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);
const IconDownload = (p) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    aria-hidden="true"
    {...p}
  >
    <path
      d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconThumbUp = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
    <path className="feedback-icon__fill" d="M7 11v10H4V11h3z" fill="currentColor" stroke="none" />
    <path
      className="feedback-icon__fill"
      d="M7 11l5-7a2 2 0 0 1 2 2v5h6a2 2 0 0 1 2 2l-2 6a2 2 0 0 1-2 2H7"
      fill="currentColor"
      stroke="none"
    />
    <path d="M7 11v10H4V11h3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path
      d="M7 11l5-7a2 2 0 0 1 2 2v5h6a2 2 0 0 1 2 2l-2 6a2 2 0 0 1-2 2H7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const IconThumbDown = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
    <path className="feedback-icon__fill" d="M7 13V3H4v10h3z" fill="currentColor" stroke="none" />
    <path
      className="feedback-icon__fill"
      d="M7 13l5 7a2 2 0 0 0 2-2v-5h6a2 2 0 0 0 2-2l-2-6a2 2 0 0 0-2-2H7"
      fill="currentColor"
      stroke="none"
    />
    <path d="M7 13V3H4v10h3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path
      d="M7 13l5 7a2 2 0 0 0 2-2v-5h6a2 2 0 0 0 2-2l-2-6a2 2 0 0 0-2-2H7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const IconRetry = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
    <path
      d="M20 12a8 8 0 1 1-2.3-5.7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M20 4v6h-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconPlay = (p) => (
  <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true" {...p}>
    <path d="M8 6.5v11l9-5.5-9-5.5Z" fill="currentColor" />
  </svg>
);

const IconPause = (p) => (
  <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true" {...p}>
    <path d="M8 6.5h3V17.5H8zM13 6.5h3V17.5h-3z" fill="currentColor" />
  </svg>
);



const CREATIVE_MODELS = [
  { id: "gpt-image-1.5", name: "GPT Image 1.5", type: "image", logo: "/models/openai.svg" },
  { id: "gpt-image-1", name: "GPT Image 1", type: "image", logo: "/models/openai.svg" },
  { id: "nano-banana-2", name: "Nano Banana 2", type: "image", logo: "/models/google.svg" },
  { id: "nano-banana-pro", name: "Nano Banana Pro", type: "image", logo: "/models/google.svg" },
  { id: "nano-banana", name: "Nano Banana", type: "image", logo: "/models/google.svg" },
  { id: "flux-2-pro", name: "Flux 2 Pro", type: "image", logo: "/models/flux.svg" },
  { id: "flux-2", name: "Flux 2", type: "image", logo: "/models/flux.svg" },
  { id: "ideogram-3", name: "Ideogram 3.0", type: "image", logo: "/models/ideogram.svg" },
  { id: "seedream-5-lite", name: "Seedream 5 Lite", type: "image", logo: "/models/seedance.svg" },
  { id: "seedream-4.5", name: "Seedream 4.5", type: "image", logo: "/models/seedance.svg" },
  { id: "grok-image", name: "xAI Grok Image", type: "image", logo: "/models/grok.svg" },
  { id: "seedance-2", name: "Seedance 2.0", type: "video", logo: "/models/seedance.svg" },
  { id: "kling-3", name: "Kling 3.0", type: "video", logo: "/models/kling.svg" },
  { id: "veo-3.1", name: "Veo 3.1", type: "video", logo: "/models/google.svg" },
  { id: "hailuo-2.3", name: "Hailuo 2.3", type: "video", logo: "/models/minimax-color.png" },
  { id: "wan-2.6", name: "Wan 2.6", type: "video", logo: "/models/qwen.svg" },
  { id: "vidu-q3", name: "Vidu Q3", type: "video", logo: "/models/vidu.svg" },
  { id: "eleven-multilingual-v2", name: "Eleven Multilingual v2", type: "voice", logo: "/models/eleven.svg" },
  { id: "minimax-02-hd", name: "MiniMax 02 HD", type: "voice", logo: "/models/minimax-color.png" },
  { id: "cartesia-sonic-2", name: "Cartesia Sonic 2", type: "voice", logo: "/models/cartesia.svg" },
  { id: "eleven-v3", name: "Eleven v3", type: "voice", logo: "/models/eleven.svg" },
  { id: "lyria-3", name: "Lyria 3", type: "music", logo: "/models/google.svg" },
  { id: "lyria-3-pro", name: "Lyria 3 Pro", type: "music", logo: "/models/google.svg" },
  { id: "suno-v5.5", name: "Suno v5.5", type: "music", logo: "/models/suno.ico" },
];
const CREATIVE_TYPES = [
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "voice", label: "Voice" },
  { id: "music", label: "Music" },
];
const CREATIVE_NEW_MODEL_BADGE_IDS = new Set([
  "nano-banana-2",
  "seedream-5-lite",
  "seedance-2",
  "kling-3",
  "hailuo-2.3",
]);
function normalizeStatusText(text) {
  return String(text || "")
    .replace(/Ã¢â‚¬Â¦/g, "...")
    .replace(/â€¦/g, "...")
    .replace(/\u2026/g, "...")
    .trim();
}

function getCreativeMessageAttachmentUrl(message) {
  const list = Array.isArray(message?.attachments) ? message.attachments : [];
  for (const item of list) {
    const url =
      (typeof item?.url === "string" && item.url) ||
      (typeof item?.previewUrl === "string" && item.previewUrl) ||
      (typeof item?.href === "string" && item.href) ||
      null;
    if (url) {
      return {
        url,
        mime: String(item?.type || "").trim() || null,
        isVideo: Boolean(item?.isVideo) || String(item?.type || "").startsWith("video/"),
        isImage: Boolean(item?.isImage) || String(item?.type || "").startsWith("image/"),
        isAudio: Boolean(item?.isAudio) || String(item?.type || "").startsWith("audio/"),
      };
    }
  }
  return null;
}

function formatAudioTime(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function CreativeAudioPlayer({ url, mime }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(30);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onLoadedMetadata = () => {
      const next = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 30;
      setDuration(next);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [url, mime]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(30);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.load();
    }
  }, [url, mime]);

  const handleTogglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch {}
  };

  const handleSeek = (event) => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Number(event.target.value || 0);
    audio.currentTime = next;
    setCurrentTime(next);
  };

  return (
    <div className="creative-audio-player">
      <audio ref={audioRef} preload="metadata">
        <source src={url} type={mime || undefined} />
      </audio>
      <button
        type="button"
        className="creative-audio-player__toggle"
        onClick={handleTogglePlay}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <IconPause /> : <IconPlay />}
      </button>
      <span className="creative-audio-player__time">{formatAudioTime(currentTime)}</span>
      <input
        type="range"
        min="0"
        max={Math.max(duration, 1)}
        step="0.01"
        value={Math.min(currentTime, duration)}
        onChange={handleSeek}
        className="creative-audio-player__range"
        aria-label="Seek audio"
      />
      <span className="creative-audio-player__time">{formatAudioTime(duration)}</span>
    </div>
  );
}

function isGeneratingStatusText(text) {
  const raw = normalizeStatusText(text).toLowerCase();
  return raw === "generating..." || raw === "a gerar..." || raw.startsWith("generating") || raw.startsWith("a gerar");
}

function GeneratingStatus({ text }) {
  const raw = normalizeStatusText(text);
  const hasTrailingDots = raw.endsWith("...");
  const label = hasTrailingDots ? raw.slice(0, -3) : raw;
  const animatedChunk = hasTrailingDots ? `${label}...` : raw;

  return (
    <span className="thinking" aria-live="polite">
      {hasTrailingDots ? (
        <span className="thinking-tail" aria-hidden="true">
          <span className="thinking-tail-ghost">{animatedChunk}</span>
          <span className="thinking-tail-live">
            <span className="thinking-tail-base">{animatedChunk}</span>
            <span className="thinking-tail-shimmer">{animatedChunk}</span>
          </span>
        </span>
      ) : (
        <span className="thinking-label">{raw}</span>
      )}
    </span>
  );
}

function CreditsBadge({ value }) {
  return (
    <span className="model-badge model-badge-credits">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="model-badge-icon">
        <path
          d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4m2-2h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="4" cy="20" r="2" fill="currentColor" stroke="none" />
      </svg>
      <span>{value}</span>
    </span>
  );
}

function formatCreditCount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(amount)));
}

function normalizeCreativeCredits(payload) {
  const limitRaw = payload?.creativeCreditsLimit ?? payload?.creativeLimit;
  const usedRaw = payload?.creativeCreditsUsed ?? payload?.creativeUsed;
  const remainingRaw = payload?.creativeCreditsRemaining ?? payload?.creativeRemaining;

  const limit = Number(limitRaw);
  const used = Number(usedRaw);
  const derivedRemaining = Number.isFinite(limit) && Number.isFinite(used) ? Math.max(0, limit - used) : NaN;
  const remaining = Number.isFinite(Number(remainingRaw)) ? Math.max(0, Number(remainingRaw)) : derivedRemaining;

  if (!Number.isFinite(limit)) return null;

  return {
    limit: Math.max(0, limit),
    used: Number.isFinite(used) ? Math.max(0, used) : 0,
    remaining: Number.isFinite(remaining) ? remaining : 0,
  };
}

function CreativeCreditsBanner({ summary }) {
  if (!summary || summary.limit <= 0) return null;

  return (
    <div className="creative-credits-banner" role="status" aria-live="polite">
      <div className="creative-credits-banner__row">
        <span className="creative-credits-banner__remaining">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="creative-credits-banner__icon">
            <path
              d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4m2-2h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="4" cy="20" r="2" fill="currentColor" stroke="none" />
          </svg>
          <span className="creative-credits-banner__count">
            <span>{formatCreditCount(summary.used)}</span>
            <span className="creative-credits-banner__slash">/</span>
            <strong>{formatCreditCount(summary.limit)}</strong>
          </span>
        </span>
      </div>
    </div>
  );
}

function normalizeUserPlanLabel(plan) {
  const normalized = String(plan || "FREE")
    .trim()
    .toUpperCase();
  return normalized || "FREE";
}

function isCreativeLimitUpgradeMessage(message) {
  return message?.role === "assistant" && message?.errorCode === "PLAN_CREATIVE_LIMIT_REACHED";
}

function buildCreativeLimitUpgradeCopy({ plan, limit }) {
  const planLabel = normalizeUserPlanLabel(plan);
  const safeLimit = Number(limit) || 0;

  const title = safeLimit > 0
    ? `You've reached the ${safeLimit}-generation monthly limit on the ${planLabel} plan.`
    : `You've reached the monthly Creative Studio limit on the ${planLabel} plan.`;

  const body =
    "Upgrade your plan to keep creating this month, or wait for your monthly Creative Studio limit to reset.";

  return { title, body };
}

function PlanUpgradeMessage({ title, body, onOpenPlan }) {
  return (
    <div className="plan-upgrade-message" role="alert">
      <div className="plan-upgrade-message__eyebrow">Upgrade required</div>
      <div className="plan-upgrade-message__title">{title}</div>
      <p className="plan-upgrade-message__body">{body}</p>
      <button type="button" className="plan-upgrade-message__button" onClick={onOpenPlan}>
        See plans
      </button>
    </div>
  );
}

const CreativeTypeIcon = ({ type }) => {
  if (type === "video") {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2 6h14v12H2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
          rx="2"
        />
      </svg>
    );
  }
  if (type === "voice") {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          d="M12 19v3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M19 10v2a7 7 0 0 1-14 0v-2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect
          x="9"
          y="2"
          width="6"
          height="13"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    );
  }
  if (type === "music") {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          d="M9 18V5l12-2v13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="18" cy="16" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="9" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};


export default function CreativeStudio({
  // chat state (vem do App)
  hasMessages,
  activeConversation,
  loading = false,

  // composer (vem do App)
  input,
  setInput,
  textareaRef,
  autoResizeTextarea,
  handleComposerChange,
  handleComposerFocus,
  handleComposerBlur,
  handleSend,
  onSubmit,

  // attachments (vem do App)
  attachments,
  addFiles,
  removeAttachment,
  fileInputRef,
  formatBytes,

  // bottom chips (vem do App)
  webSearchEnabled,
  setWebSearchEnabled,
  reasoningEnabled,
  setReasoningEnabled,

  // modelo ativo (vem do App)
  activeCreativeModel,
  setActiveCreativeModel,
  creativeCredits,
  selectedCreativeEditTarget,
  onSelectCreativeEditTarget,
  onClearCreativeEditTarget,
  onOpenPlan,

  // “model selector” atual (do chat normal) — vamos esconder aqui, porque no Creative usamos tool+model próprios
}) {
  const isMobile =
    typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
  const hasCoarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia &&
    (window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(any-pointer: coarse)").matches ||
      (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0));
  const isTabletBrowser =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(min-width: 721px) and (max-width: 1366px)").matches &&
    hasCoarsePointer;
  const shouldSubmitOnEnter = !isMobile && !isTabletBrowser;
  const {
    isDragActive: isComposerFileDragActive,
    dropTargetProps: composerFileDropProps,
  } = useFileDropTarget({
    onFiles: addFiles,
    disabled: !activeConversation,
  });

  const handleCreativeComposerPaste = async (event) => {
    const files = await extractTransferFiles(event.clipboardData);
    if (files.length === 0) return;

    event.preventDefault();
    addFiles(files);
  };

  const stabilizeIOSFocus = () => {
    if (!isMobile && !isTabletBrowser) return;
    if (typeof window === "undefined") return;

    const ua = navigator.userAgent || "";
    const isiOS =
      /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && typeof document !== "undefined" && "ontouchend" in document);

    if (!isiOS) return;

    const prevWindowY =
      window.pageYOffset || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
    const el = chatBodyRef.current;
    const prevElTop = el ? el.scrollTop : null;
    const emptyEl = emptyBodyRef.current;
    const prevEmptyTop = emptyEl ? emptyEl.scrollTop : null;

    const restore = () => {
      // iOS Safari às vezes tenta "aproximar"/scroll ao focar inputs — repõe a posição.
      try {
        window.scrollTo(0, prevWindowY);
      } catch {}
      if (chatBodyRef.current && typeof prevElTop === "number") {
        chatBodyRef.current.scrollTop = prevElTop;
      }
      if (emptyBodyRef.current && typeof prevEmptyTop === "number") {
        emptyBodyRef.current.scrollTop = prevEmptyTop;
      }
    };

    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 50);
    window.setTimeout(restore, 150);
  };

  const focusTextareaSafe = () => {
    const el = textareaRef?.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      try {
        el.focus();
      } catch {}
    }
    stabilizeIOSFocus();
  };

  const handleCreativeComposerChange = (e) => {
    const container = hasMessages ? chatBodyRef.current : emptyBodyRef.current;
    const prevTop = container ? container.scrollTop : null;

    if (typeof handleComposerChange === "function") {
      handleComposerChange(e);
    } else {
      setInput(e.target.value);
      const el = e.target || textareaRef?.current;
      if (el) {
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
      }
    }

    if (container && typeof prevTop === "number") {
      container.scrollTop = prevTop;
    }
  };

  const handleCreativeComposerFocus = () => {
    if (typeof handleComposerFocus === "function") handleComposerFocus();
    stabilizeIOSFocus();
  };

  const handleCreativeComposerBlur = () => {
    if (typeof handleComposerBlur === "function") handleComposerBlur();
  };

  const DEFAULT_CREATIVE_MODEL = "gpt-image-1.5";
  const CREATIVE_MODEL_ALIASES = {
    "runway-gen-4.5": "vidu-q3",
  };
  const normalizedActiveCreativeModel =
    typeof activeCreativeModel === "string"
      ? (CREATIVE_MODEL_ALIASES[activeCreativeModel.trim()] || activeCreativeModel.trim())
      : "";
  const activeModel = CREATIVE_MODELS.some((m) => m.id === normalizedActiveCreativeModel)
    ? normalizedActiveCreativeModel
    : DEFAULT_CREATIVE_MODEL;
  const activeModelMeta = CREATIVE_MODELS.find((m) => m.id === activeModel) || CREATIVE_MODELS[0];
  const setActiveModel = typeof setActiveCreativeModel === "function" ? setActiveCreativeModel : () => {};
  const location = useLocation();
  const [creativeType, setCreativeType] = useState(activeModelMeta?.type || "image");
  const firstModelForCreativeType = useMemo(
    () => CREATIVE_MODELS.find((m) => m.type === creativeType) || CREATIVE_MODELS[0],
    [creativeType]
  );
  const displayModelMeta =
    activeModelMeta?.type === creativeType ? activeModelMeta : firstModelForCreativeType;

useEffect(() => {
  const params = new URLSearchParams(location.search);
  const modelFromUrl = params.get("model");

  if (!modelFromUrl) return;

  // Some places may use slightly different ids; normalize a few aliases here.
  const MODEL_ALIASES = {
    "gpt-image": "gpt-image-1.5",
    "ideogram-3.0": "ideogram-3",
    "runway-gen-4.5": "vidu-q3",
  };

  const resolvedModel = MODEL_ALIASES[modelFromUrl] || modelFromUrl;

  const exists = CREATIVE_MODELS.some((m) => m.id === resolvedModel);

  if (exists) {
    setActiveModel(resolvedModel);
  }
}, [location.search]);

  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [creativeModelCredits, setCreativeModelCredits] = useState({});
  const [loadedVideoUrls, setLoadedVideoUrls] = useState({});
const modelMenuRef = useRef(null);
const typeMenuRef = useRef(null);
const [msgRatings, setMsgRatings] = useState({});
// 🔽 scroll logic (igual ao App.jsx)
const chatBodyRef = useRef(null);
const emptyBodyRef = useRef(null);
const chatInputWrapperRef = useRef(null);
const suppressScrollBtnRef = useRef(false);
const [showScrollDown, setShowScrollDown] = useState(false);
const [scrollDownButtonBottom, setScrollDownButtonBottom] = useState(200);

// ✅ Toast local (igual ao App) — canto inferior direito
const [globalToast, setGlobalToast] = useState(null); // { text }
const toastTimerRef = useRef(null);
const downloadMedia = async (url, filename) => {
  try {
    const blob = await apiGetBlob(url);

    const objectUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch (e) {
    console.error("Erro ao guardar media", e);
  }
};

const showGlobalToast = (text) => {
  if (toastTimerRef.current) clearTimeout(toastTimerRef.current);

  setGlobalToast({ text });

  toastTimerRef.current = setTimeout(() => {
    setGlobalToast(null);
    toastTimerRef.current = null;
  }, 2000);
};

useEffect(() => {
  return () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  };
}, []);

const selectedCreativeEditUrl =
  typeof selectedCreativeEditTarget?.url === "string" ? selectedCreativeEditTarget.url : "";
const selectedCreativeEditPreviewUrl =
  typeof selectedCreativeEditTarget?.previewUrl === "string" && selectedCreativeEditTarget.previewUrl
    ? selectedCreativeEditTarget.previewUrl
    : selectedCreativeEditUrl;

const handleSelectCreativeImageForEdit = ({ url }) => {
  const conversationId = activeConversation?.id;
  if (!conversationId || !url || typeof onSelectCreativeEditTarget !== "function") return;

  onSelectCreativeEditTarget({
    conversationId,
    url,
    previewUrl: url,
  });
  showGlobalToast("Image selected for editing");
  requestAnimationFrame(() => {
    focusTextareaSafe();
  });
};

const handleClearCreativeImageSelection = () => {
  const conversationId = activeConversation?.id;
  if (!conversationId || typeof onClearCreativeEditTarget !== "function") return;

  onClearCreativeEditTarget(conversationId);
};

const renderCreativeEditTargetBanner = () => {
  if (!selectedCreativeEditUrl) return null;

  return (
    <div className="creative-edit-target" role="status" aria-live="polite">
      <img
        className="creative-edit-target__thumb"
        src={selectedCreativeEditPreviewUrl}
        alt="Selected image for editing"
      />
      <div className="creative-edit-target__meta">
        <div className="creative-edit-target__title">Editing selected image</div>
        <div className="creative-edit-target__subtitle">Your next prompt will modify this image.</div>
      </div>
      <button
        type="button"
        className="creative-edit-target__clear"
        onClick={handleClearCreativeImageSelection}
        aria-label="Clear selected image"
        title="Clear selected image"
      >
        ×
      </button>
    </div>
  );
};

const getMsgKey = (message, i) => {
  const conversationId = activeConversation?.id ?? "creative";
  const messageId =
    message?.id ||
    message?.messageId ||
    message?.createdAt ||
    message?.mediaUrl ||
    message?.url ||
    message?.fileUrl ||
    message?.assetUrl ||
    (typeof message?.content === "string" ? message.content.slice(0, 120) : message?.role) ||
    i;
  return `${conversationId}-${messageId}-${i}`;
};
const markVideoLoaded = (url) => {
  if (!url) return;
  setLoadedVideoUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
};
const scrollToBottom = (behavior = "auto") => {
  const el = chatBodyRef.current;
  if (!el) return;

  el.scrollTop = el.scrollHeight;

  requestAnimationFrame(() => {
    el.scrollTo({
      top: el.scrollHeight,
      behavior,
    });
  });
};
// ✅ ler ?model=... da URL (Explore -> Creative Studio)



  useEffect(() => {
    if (activeModelMeta?.type) setCreativeType(activeModelMeta.type);
  }, [activeModelMeta?.type]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await api.get("/ai/creative/models");
        const models = Array.isArray(res?.data?.models) ? res.data.models : [];
        if (cancelled) return;

        const nextCredits = {};
        for (const model of models) {
          const id = typeof model?.id === "string" ? model.id.trim() : "";
          const creditCost = Number(model?.creditCost);
          if (!id || !Number.isFinite(creditCost)) continue;
          nextCredits[id] = Math.max(0, Math.round(creditCost));
        }
        setCreativeModelCredits(nextCredits);
      } catch {
        if (!cancelled) setCreativeModelCredits({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    const pool = CREATIVE_MODELS.filter((m) => m.type === creativeType);
    if (!q) return pool;
    return pool.filter((m) => m.name.toLowerCase().includes(q));
  }, [creativeType, modelQuery]);

useEffect(() => {
  if (!modelMenuOpen && !typeMenuOpen) return;

  function handleClickOutside(e) {
    if (modelMenuRef.current && !modelMenuRef.current.contains(e.target)) {
      setModelMenuOpen(false);
    }
    if (typeMenuRef.current && !typeMenuRef.current.contains(e.target)) {
      setTypeMenuOpen(false);
    }
  }

  document.addEventListener("mousedown", handleClickOutside);
  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
  };
}, [modelMenuOpen, typeMenuOpen]);
// 👀 mostrar / esconder botão "descer"
useEffect(() => {
  const el = chatBodyRef.current;
  if (!el) return;

  const onScroll = () => {
    if (suppressScrollBtnRef.current) return;

    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;

    setShowScrollDown(distanceFromBottom > 120);
  };

  el.addEventListener("scroll", onScroll, { passive: true });
  setShowScrollDown(false);

  return () => el.removeEventListener("scroll", onScroll);
}, [activeConversation?.messages?.length]);
// ⬇️ auto-scroll quando chegam novas mensagens (igual ao App)
useEffect(() => {
  const el = chatBodyRef.current;
  if (!el) return;

  const distanceFromBottom =
    el.scrollHeight - el.scrollTop - el.clientHeight;

  // só desce se o utilizador já estiver perto do fundo
  if (distanceFromBottom < 200) {
    scrollToBottom("smooth");
  }
}, [activeConversation?.messages?.length]);
// ⬇️ AUTO-SCROLL FORÇADO quando o USER envia mensagem (IGUAL AO App.jsx)
useEffect(() => {
  if (!activeConversation) return;

  const lastMsg =
    activeConversation.messages?.[activeConversation.messages.length - 1];

  if (lastMsg?.role === "user") {
    requestAnimationFrame(() => {
      scrollToBottom("smooth");
    });
  }
}, [activeConversation?.messages?.length]);

// ⬇️ quando mudas de conversa → abre SEMPRE no fundo
useEffect(() => {
  const el = chatBodyRef.current;
  if (!el) return;

  suppressScrollBtnRef.current = true;
  setShowScrollDown(false);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollToBottom("auto");
      setShowScrollDown(false);

      requestAnimationFrame(() => {
        suppressScrollBtnRef.current = false;
      });
    });
  });
}, [activeConversation?.id]);

useEffect(() => {
  if (!hasMessages) {
    setScrollDownButtonBottom(200);
    return;
  }

  const el = chatInputWrapperRef.current;
  if (!el || typeof window === "undefined") return;

  let rafId = 0;
  const apply = () => {
    rafId = 0;
    const h = Math.ceil(el.getBoundingClientRect().height || 0);
    const nextBottom = Math.max(200, h + 14);
    setScrollDownButtonBottom((prev) => (prev === nextBottom ? prev : nextBottom));
  };
  const schedule = () => {
    if (rafId) return;
    rafId = window.requestAnimationFrame(apply);
  };

  schedule();

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
  try {
    ro?.observe(el);
  } catch {
    // ignore
  }

  const vv = window.visualViewport;
  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);

  return () => {
    ro?.disconnect();
    vv?.removeEventListener("resize", schedule);
    vv?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    if (rafId) window.cancelAnimationFrame(rafId);
  };
}, [hasMessages, activeConversation?.id]);



  return (
  <div className={`creative-wrap ${hasMessages ? "is-chat" : ""}`}>
    {/* ✅ Toast global (canto inferior direito) */}
{globalToast && (
  <div className="global-toast" role="status" aria-live="polite">
    <span className="global-toast-check" aria-hidden="true">✓</span>
    <span className="global-toast-text">{globalToast.text}</span>
  </div>
)}
    {!hasMessages && <div className="creative-bg" />}
    <div className="creative-inner">
        {!hasMessages ? (
          <div className="creative-empty" ref={emptyBodyRef}>
            <div className="creative-hero">
              <div className="creative-brand">
                
                <h1 className="creative-title">Creative Studio</h1>
                <p className="creative-subtitle">
                  Ask for a creation. I'll take care of the rest.
                </p>
              </div>
<div className="creative-gallery">
  {CREATIVE_INSPIRATION.map((item) => (
    <button
      key={item.id}
      className={`creative-tile creative-tile-${item.size}`}
      data-tile-id={item.id}
      onClick={() => {
        setInput(item.prompt);
        requestAnimationFrame(() => {
          focusTextareaSafe();
        });
      }}
      type="button"
    >
      <img src={item.image} alt={item.title} loading="lazy" />
      <div className="creative-tile-overlay">
        <span>{item.title}</span>
      </div>
    </button>
  ))}
</div>

            
            </div>

            {/* composer centrado (igual ao teu “novo chat”, mas com estilo creative) */}
            <div className={`chat-input-wrapper${isMobile ? "" : " centered"} creative-centered`}>
              <div className="creative-credits-banner-shell creative-credits-banner-shell-mobile">
                <CreativeCreditsBanner summary={creativeCredits} />
              </div>
              <form onSubmit={onSubmit} className="chat-input-form">
                <div
                  className={`composer creative-composer${isComposerFileDragActive ? " composer-drag-active" : ""}`}
                  {...composerFileDropProps}
                >
                  {isComposerFileDragActive ? (
                    <ComposerFileDropOverlay subtitle="They'll be attached to your next creation." />
                  ) : null}
                  <div className="composer-top">
                    {renderCreativeEditTargetBanner()}
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      value={input}
                      onFocus={handleCreativeComposerFocus}
                      onBlur={handleCreativeComposerBlur}
                      onChange={handleCreativeComposerChange}
                      placeholder="Describe what you want to create…"
                      disabled={!activeConversation}
                      onPaste={handleCreativeComposerPaste}
                      onKeyDown={(e) => {
                        if (shouldSubmitOnEnter && e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      className="composer-textarea"
                    />
                  </div>

                  {/* anexos (mantém) */}
                  {attachments.length > 0 && (
                    <div className="composer-attachments-row">
                      {attachments.map((a) => (
                        <div key={a.id} className="attach-tile">
                          {a.isImage && a.previewUrl ? (
                            <img className="attach-thumb" src={a.previewUrl} alt={a.name} />
                          ) : (
                            <div className="attach-file-ico" aria-hidden="true">
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                              </svg>
                            </div>
                          )}

                          <div className="attach-meta">
                            <div className="attach-name">{a.name}</div>
                            <div className="attach-sub">
                              {formatBytes(a.size)}
                              {a.type ? ` • ${a.type}` : ""}
                            </div>
                          </div>

                          <button
                            type="button"
                            className="attach-x"
                            onClick={() => removeAttachment(a.id)}
                            aria-label="Remover anexo"
                            title="Remover"
                          >
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="composer-bottom">
                    {/* 📎 */}
                    <label className="composer-plus" title="Attach file">
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="composer-file"
                        multiple
                        onChange={(e) => addFiles(e.target.files)}
                      />
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <path
    d="M12 5v14M5 12h14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  />
</svg>

                    </label>

                    <div className="creative-credits-banner-shell creative-credits-banner-shell-desktop">
                      <CreativeCreditsBanner summary={creativeCredits} />
                    </div>

                    {/* chips (mantém) */}
                    

                    
                    <div className="composer-actions">
                      <div className="creative-type-selector" ref={typeMenuRef}>
                        <button
                          type="button"
                          className="creative-type-trigger"
                          onClick={() => {
                            setTypeMenuOpen((v) => !v);
                            setModelMenuOpen(false);
                          }}
                        >
                          <CreativeTypeIcon type={creativeType} />
                          <span className="creative-type-name">
                            {CREATIVE_TYPES.find((item) => item.id === creativeType)?.label || "Image"}
                          </span>
                        </button>

                        {typeMenuOpen && (
                          <div className="creative-type-menu" onClick={(e) => e.stopPropagation()}>
                            {CREATIVE_TYPES.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className={`creative-type-item ${item.id === creativeType ? "active" : ""}`}
                                onClick={() => {
                                  const firstModelForType = CREATIVE_MODELS.find((m) => m.type === item.id);
                                  setCreativeType(item.id);
                                  if (firstModelForType) setActiveModel(firstModelForType.id);
                                  setTypeMenuOpen(false);
                                  setModelMenuOpen(false);
                                  setModelQuery("");
                                }}
                              >
                                <span className="creative-type-item-icon">
                                  <CreativeTypeIcon type={item.id} />
                                </span>
                                <span className="creative-type-item-text">{item.label}</span>
                                {item.id !== "image" && item.id !== "video" ? (
                                  <span className="creative-type-item-badge">Soon</span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="model-selector">
                        <button
                          type="button"
                          className="model-trigger"
                          onClick={() => {
                            setModelMenuOpen((v) => !v);
                            setTypeMenuOpen(false);
                          }}
                        >
                          <img
                            src={displayModelMeta?.logo}
                            alt=""
                            className="model-logo"
                          />
                          <span className="model-name">
                            {displayModelMeta?.name}
                          </span>
                        </button>

                        {modelMenuOpen && (
                          <div
  className="model-menu"
  ref={modelMenuRef}
  onClick={(e) => e.stopPropagation()}
>
                            <div className="model-menu-head">
                              <input
                                className="model-search"
                                value={modelQuery}
                                onChange={(e) => setModelQuery(e.target.value)}
                                placeholder="Search model…"
                                autoFocus={!isMobile && !isTabletBrowser}
                                onFocus={stabilizeIOSFocus}
                              />
                            </div>

                            <div className="model-menu-list">
  {filteredModels.map((model) => (
      <button
        key={model.id}
        className={`model-item ${model.id === activeModel ? "active" : ""}`}
        onClick={() => {
          setActiveModel(model.id);
          setModelMenuOpen(false);
          setModelQuery("");
        }}
      >
        <img src={model.logo} alt="" />
        <span className="model-item-main">
          <span className="model-item-name">{model.name}</span>
          {Number.isFinite(creativeModelCredits[model.id]) ? (
            <CreditsBadge value={creativeModelCredits[model.id]} />
          ) : null}
          {CREATIVE_NEW_MODEL_BADGE_IDS.has(model.id) ? (
            <span className="model-badge model-badge-new">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="model-badge-icon">
                <path
                  d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>NEW</span>
            </span>
          ) : null}
        </span>
      </button>
    ))}

  {filteredModels.length === 0 && (
    <div className="model-empty">
      {creativeType === "image"
        ? "Sem resultados"
        : `${CREATIVE_TYPES.find((item) => item.id === creativeType)?.label || "This"} models coming soon.`}
    </div>
  )}
</div>
                          </div>
                        )}
                      </div>

                      <button
                        type="submit"
                        className="composer-send"
                        disabled={!activeConversation}
                        title="Send"
                        onClick={() => {
                          autoResizeTextarea?.();
                        }}
                      >
                        <svg width="18" height="18" viewBox="0 0 27 24" aria-hidden="true">
                          <path d="M2 12L22 3L14 21L11 13L2 12Z" fill="currentColor" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
                ) : (
<>
  {/* ✅ Mensagens em layout igual ao chat normal (mesmas classes) */}
  <div className="creative-main-body" ref={chatBodyRef}>
    <div className="messages creative-messages">
      {(activeConversation?.messages || []).map((m, i) => {
        const msgKey = getMsgKey(m, i);
        const isLastMsg = i === (activeConversation?.messages || []).length - 1;
        const isCreativeLimitError = isCreativeLimitUpgradeMessage(m);
        const hideAssistantActions =
          isCreativeLimitError || (m.role === "assistant" && loading && isLastMsg);
        const attachmentMedia = getCreativeMessageAttachmentUrl(m);
        const rawUrl =
          attachmentMedia?.url ||
          m.mediaUrl ||
          m.url ||
          m.fileUrl ||
          m.assetUrl ||
          (typeof m.content === "string" ? m.content.match(/https?:\/\/\S+/)?.[0] ?? null : null);
        const url = (() => {
          if (!rawUrl) return null;
          const value = String(rawUrl).trim();
          const localMatch = value.match(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(\/media\/.*)$/i);
          if (localMatch) return `${window.location.origin}${localMatch[1]}`;
          return value;
        })();
        const isVideo =
          m.mediaType === "video" ||
          attachmentMedia?.isVideo ||
          (url ? /\.(mp4|webm|mov)(\?|#|$)/i.test(url) : false);
        const isAudio =
          m.mediaType === "audio" ||
          attachmentMedia?.isAudio ||
          (url ? /\.(mp3|wav|m4a|aac|ogg)(\?|#|$)/i.test(url) : false);
        const isGeneratingMessage =
          m.role === "assistant" && !url && isGeneratingStatusText(m.content);
        const isAssistantImage = m.role === "assistant" && url && !isVideo && !isAudio;
        const isSelectedForEdit = Boolean(
          isAssistantImage && selectedCreativeEditUrl && selectedCreativeEditUrl === url
        );
        const creativeLimitCopy = isCreativeLimitError
          ? buildCreativeLimitUpgradeCopy({
              plan: m.errorMeta?.plan,
              limit: m.errorMeta?.limit,
            })
          : null;

        return (
          <div key={msgKey} className="msg-wrapper">
            
            {m.role === "user" && Array.isArray(m.attachments) && m.attachments.length > 0 && (
              <div className="msg-attachments">
                {m.attachments.map((a) => (
                  <div key={a.id || a.name} className="msg-attach-tile">
                    {a.isImage && a.previewUrl ? (
                      <img className="msg-attach-thumb" src={a.previewUrl} alt={a.name} />
                    ) : (
                      <div className="msg-attach-file" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                      </div>
                    )}
                    <div className="msg-attach-meta">
                      <div className="msg-attach-name">{a.name}</div>
                      <div className="msg-attach-sub">{formatBytes(a.size)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
<div className={`msg ${m.role === "user" ? "msg-user" : "msg-ai"}`}>
              {isCreativeLimitError ? (
                <PlanUpgradeMessage
                  title={creativeLimitCopy?.title}
                  body={creativeLimitCopy?.body}
                  onOpenPlan={onOpenPlan}
                />
              ) : isGeneratingMessage ? (
                <GeneratingStatus text={m.content} />
              ) : m.role === "assistant" && url && isVideo ? (
                <div className={`creative-video-card ${loadedVideoUrls[url] ? "is-loaded" : "is-loading"}`}>
                  {!loadedVideoUrls[url] ? <div className="creative-video-card__veil" aria-hidden="true" /> : null}
                  <video
                    key={`${msgKey}-${url}`}
                    controls
                    preload="auto"
                    playsInline
                    className="creative-video-card__media"
                    onLoadedData={() => markVideoLoaded(url)}
                    onLoadedMetadata={() => markVideoLoaded(url)}
                    onCanPlay={() => markVideoLoaded(url)}
                    style={{ opacity: loadedVideoUrls[url] ? 1 : 0 }}
                  >
                    <source src={url} />
                  </video>
                </div>
              ) : m.role === "assistant" && url && isAudio ? (
                <div className="creative-audio-card">
                  <CreativeAudioPlayer url={url} mime={attachmentMedia?.mime || null} />
                </div>
              ) : isAssistantImage ? (
                <div className={`creative-media-card${isSelectedForEdit ? " is-selected" : ""}`}>
                  <img
                    src={url}
                    alt="Resultado"
                    style={{ maxWidth: "100%", borderRadius: 12 }}
                  />
                  <button
                    type="button"
                    className={`creative-media-card__edit${isSelectedForEdit ? " is-selected" : ""}`}
                    onClick={() => handleSelectCreativeImageForEdit({ url })}
                    aria-label="Edit this image"
                    aria-pressed={isSelectedForEdit}
                    title={isSelectedForEdit ? "Selected for editing" : "Edit this image"}
                  >
                    <IconEdit />
                    <span>{isSelectedForEdit ? "Selected" : "Edit"}</span>
                  </button>
                </div>
              ) : (
                m.content
              )}
            </div>

            {/* ACTIONS (igual ao App.jsx/App.css) */}
            {m.role === "user" ? (
                      <div className="msg-actions msg-actions-user">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Copy"
                  data-tip="Copy"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(m.content);
                      showGlobalToast("Copied to clipboard");
                    } catch {}
                  }}
                >
                  <IconCopy />
                </button>

                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Edit"
                  data-tip="Edit"
                  onClick={() => {
                    setInput(m.content);

                    requestAnimationFrame(() => {
                      autoResizeTextarea?.();
                      focusTextareaSafe();
                    });
                  }}
                >
                  <IconEdit />
                </button>
              </div>
            ) : (
              hideAssistantActions ? null : (
              <div className="msg-actions msg-actions-ai">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Copy"
                  data-tip="Copy"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(m.content);
                      showGlobalToast("Copied to clipboard");
                    } catch {}
                  }}
                >
                  <IconCopy />
                </button>

                {/* ✅ Guardar (ao lado do Copiar) */}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Save"
                  data-tip="Save"
                  onClick={async () => {
                    const url =
                      m.mediaUrl ||
                      m.url ||
                      m.fileUrl ||
                      m.assetUrl ||
                      (typeof m.content === "string"
                        ? m.content.match(/https?:\/\/\S+/)?.[0] ?? null
                        : null);

                    if (!url) {
                      showGlobalToast("No media to save");
                      return;
                    }

                    const isVideo =
                      m.mediaType === "video" ||
                      /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
                    const isAudio =
                      m.mediaType === "audio" ||
                      /\.(mp3|wav|m4a|aac|ogg)(\?|#|$)/i.test(url);
                    const ext = isVideo ? "mp4" : isAudio ? "mp3" : "png";
                    const filename = `core-ai-${Date.now()}.${ext}`;

                    await downloadMedia(url, filename);
                    showGlobalToast("Saved in transfers");
                  }}
                >
                  <IconDownload />
                </button>

                <button
                  type="button"
                  className={`icon-btn ${msgRatings[msgKey] === "up" ? "is-active" : ""}`}
                  aria-label="Like"
                  data-tip="Like"
                  aria-pressed={msgRatings[msgKey] === "up"}
                  onClick={() => {
                    setMsgRatings((prev) => {
                      const next = { ...prev };
                      next[msgKey] = prev[msgKey] === "up" ? undefined : "up";
                      return next;
                    });
                  }}
                >
                  <IconThumbUp />
                </button>

                <button
                  type="button"
                  className={`icon-btn ${msgRatings[msgKey] === "down" ? "is-active" : ""}`}
                  aria-label="Dislike"
                  data-tip="Dislike"
                  aria-pressed={msgRatings[msgKey] === "down"}
                  onClick={() => {
                    setMsgRatings((prev) => {
                      const next = { ...prev };
                      next[msgKey] = prev[msgKey] === "down" ? undefined : "down";
                      return next;
                    });
                  }}
                >
                  <IconThumbDown />
                </button>

                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Try again"
                  data-tip="Try again"
                  onClick={() => {
                    const prevUser = [...(activeConversation?.messages || [])]
                      .slice(0, i)
                      .reverse()
                      .find((x) => x.role === "user");

                    if (prevUser) handleSend(prevUser.content);
                  }}
                >
                  <IconRetry />
                </button>
              </div>
              )
            )}
          </div>
        );
      })}
    </div>
  </div>

  <button
    className={`scroll-to-bottom ${showScrollDown ? "visible" : ""}`}
    onClick={() => scrollToBottom("smooth")}
    aria-label="Scroll to bottom"
    title="Scroll to bottom"
    style={{ bottom: `calc(${scrollDownButtonBottom}px + env(safe-area-inset-bottom, 0px))` }}
  >
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M12 16c-.3 0-.6-.1-.8-.3l-5-5a1.1 1.1 0 011.6-1.6L12 13.3l4.2-4.2a1.1 1.1 0 011.6 1.6l-5 5c-.2.2-.5.3-.8.3z"
        fill="currentColor"
      />
    </svg>
  </button>

  {/* ✅ Composer em baixo (NÃO centrado) */}
  <div className="chat-input-wrapper" ref={chatInputWrapperRef}>
    <div className="creative-credits-banner-shell creative-credits-banner-shell-mobile">
      <CreativeCreditsBanner summary={creativeCredits} />
    </div>
    <form onSubmit={onSubmit} className="chat-input-form">
      <div
        className={`composer creative-composer${isComposerFileDragActive ? " composer-drag-active" : ""}`}
        {...composerFileDropProps}
      >
        {isComposerFileDragActive ? (
          <ComposerFileDropOverlay subtitle="They'll be attached to your next creation." />
        ) : null}
        <div className="composer-top">
          {renderCreativeEditTargetBanner()}
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onFocus={handleCreativeComposerFocus}
            onBlur={handleCreativeComposerBlur}
            onChange={handleCreativeComposerChange}
            placeholder="Describe what you want to create…"
            disabled={!activeConversation}
            onPaste={handleCreativeComposerPaste}
            onKeyDown={(e) => {
              if (shouldSubmitOnEnter && e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            className="composer-textarea"
          />
        </div>

        {/* anexos (mantém igual) */}
        {attachments.length > 0 && (
          <div className="composer-attachments-row">
            {attachments.map((a) => (
              <div key={a.id} className="attach-tile">
                {a.isImage && a.previewUrl ? (
                  <img className="attach-thumb" src={a.previewUrl} alt={a.name} />
                ) : (
                  <div className="attach-file-ico" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                  </div>
                )}

                <div className="attach-meta">
                  <div className="attach-name">{a.name}</div>
                  <div className="attach-sub">
                    {formatBytes(a.size)}
                    {a.type ? ` • ${a.type}` : ""}
                  </div>
                </div>

                <button
                  type="button"
                  className="attach-x"
                  onClick={() => removeAttachment(a.id)}
                  aria-label="Remover anexo"
                  title="Remover"
                >
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="composer-bottom">
          <label className="composer-plus" title="Attach file">
            <input
              ref={fileInputRef}
              type="file"
              className="composer-file"
              multiple
              onChange={(e) => addFiles(e.target.files)}
            />
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </label>

          <div className="creative-credits-banner-shell creative-credits-banner-shell-desktop">
            <CreativeCreditsBanner summary={creativeCredits} />
          </div>

          <div className="composer-actions">
            <div className="creative-type-selector" ref={typeMenuRef}>
              <button
                type="button"
                className="creative-type-trigger"
                onClick={() => {
                  setTypeMenuOpen((v) => !v);
                  setModelMenuOpen(false);
                }}
              >
                <CreativeTypeIcon type={creativeType} />
                <span className="creative-type-name">
                  {CREATIVE_TYPES.find((item) => item.id === creativeType)?.label || "Image"}
                </span>
              </button>

              {typeMenuOpen && (
                <div className="creative-type-menu" onClick={(e) => e.stopPropagation()}>
                  {CREATIVE_TYPES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`creative-type-item ${item.id === creativeType ? "active" : ""}`}
                      onClick={() => {
                        const firstModelForType = CREATIVE_MODELS.find((m) => m.type === item.id);
                        setCreativeType(item.id);
                        if (firstModelForType) setActiveModel(firstModelForType.id);
                        setTypeMenuOpen(false);
                        setModelMenuOpen(false);
                        setModelQuery("");
                      }}
                    >
                      <span className="creative-type-item-icon">
                        <CreativeTypeIcon type={item.id} />
                      </span>
                      <span className="creative-type-item-text">{item.label}</span>
                      {item.id === "voice" ? (
                        <span className="creative-type-item-badge">Soon</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="model-selector" ref={modelMenuRef}>
              <button
                type="button"
                className="model-trigger"
                onClick={() => {
                  setModelMenuOpen((v) => !v);
                  setTypeMenuOpen(false);
                }}
              >
                <img
  src={displayModelMeta?.logo}
  alt=""
  className="model-logo"
/>
<span className="model-name">
  {displayModelMeta?.name}
</span>
              </button>

              {modelMenuOpen && (
                <div className="model-menu" onClick={(e) => e.stopPropagation()}>
                  <div className="model-menu-head">
                    <input
                      className="model-search"
                      value={modelQuery}
                      onChange={(e) => setModelQuery(e.target.value)}
                      placeholder="Search model…"
                      autoFocus={!isMobile && !isTabletBrowser}
                      onFocus={stabilizeIOSFocus}
                    />
                  </div>

                  <div className="model-menu-list">
                    {filteredModels.map((model) => (
                        <button
                          key={model.id}
                          className={`model-item ${model.id === activeModel ? "active" : ""}`}
                          onClick={() => {
                            setActiveModel(model.id);
                            setModelMenuOpen(false);
                            setModelQuery("");
                          }}
                        >
                          <img src={model.logo} alt="" />
                          <span className="model-item-main">
                            <span className="model-item-name">{model.name}</span>
                            {Number.isFinite(creativeModelCredits[model.id]) ? (
                              <CreditsBadge value={creativeModelCredits[model.id]} />
                            ) : null}
                            {CREATIVE_NEW_MODEL_BADGE_IDS.has(model.id) ? (
                              <span className="model-badge model-badge-new">
                                <svg viewBox="0 0 24 24" aria-hidden="true" className="model-badge-icon">
                                  <path
                                    d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                                <span>NEW</span>
                              </span>
                            ) : null}
                          </span>
                        </button>
                      ))}

                    {filteredModels.length === 0 && (
                      <div className="model-empty">
                        {creativeType === "image"
                          ? "Sem resultados"
                          : `${CREATIVE_TYPES.find((item) => item.id === creativeType)?.label || "This"} models coming soon.`}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              className="composer-send"
              disabled={!activeConversation}
              title="Send"
              onClick={() => autoResizeTextarea?.()}
            >
              <svg width="18" height="18" viewBox="0 0 27 24" aria-hidden="true">
                <path d="M2 12L22 3L14 21L11 13L2 12Z" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </form>
  </div>
   </>
 )}
 </div>
 </div>
 );
 }
