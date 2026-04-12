import { useState } from "react";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./explorar.css";

const MODELS = {
  chat: [
  {
    id: "gpt",
    name: "GPT",
    description: "OpenAI’s most advanced conversational model for reasoning, writing and coding.",
    logo: "/models/openai.svg",
  },
  {
    id: "claude",
    name: "Claude",
    description: "Anthropic’s AI focused on reasoning, safety and long-form answers.",
    logo: "/models/anthropic.svg",
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Google’s AI built for multimodal intelligence, fast reasoning, and real-time knowledge.",
    logo: "/models/google.svg",
  },
  {
    id: "grok",
    name: "Grok",
    description: "xAI’s real-time AI with fast, witty and bold responses.",
    logo: "/models/grok.svg",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    description: "Answer-focused AI combining search and reasoning.",
    logo: "/models/perplexity.svg",
  },
  {
    id: "nemotron",
    name: "NVIDIA Nemotron",
    description: "NVIDIA’s high-performance reasoning model built for fast, efficient long-context work.",
    logo: "https://cdn.simpleicons.org/nvidia/76B900",
  },
  {
    id: "minimax",
    name: "MiniMax",
    description: "MiniMax’s long-context reasoning model for fast, capable chat workflows.",
    logo: "/models/minimax-color.png",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "High-performance reasoning models optimized for math and code.",
    logo: "/models/deepseek.svg",
  },
  {
    id: "qwen",
    name: "Qwen",
    description: "Alibaba’s multilingual models with strong reasoning capabilities.",
    logo: "/models/qwen.svg",
  },
  {
    id: "kimi",
    name: "Kimi",
    description: "General-purpose AI assistant with strong reasoning and long-context capabilities.",
    logo: "/models/kimi.svg",
  },
],
 image: [
  {
    id: "gpt-image",
    name: "GPT Image",
    description: "OpenAI’s image generation model for high-quality visuals.",
    logo: "/models/openai.svg",
  },
  {
    id: "flux",
    name: "Flux",
    description: "High-quality artistic image generation with creative freedom.",
    logo: "/models/flux.svg",
  },
  {
    id: "ideogram",
    name: "Ideogram",
    description: "Best-in-class typography and text-in-image generation.",
    logo: "/models/ideogram.svg",
  },
  {
    id: "nano-banana-2",
    name: "Nano Banana",
    description: "Fast, clean image generation (newest version) for social media and concepts.",
    logo: "/models/google.svg",
  },
  {
    id: "grok-image",
    name: "xAI Grok Image",
    description: "Creative, high-quality image generation with strong visual reasoning.",
    logo: "/models/grok.svg",
  },
    {
    id: "seedream",
    name: "Seedream",
    description: "Stylized, artistic visuals ideal for concepts and storytelling.",
    logo: "/models/seedance.svg",
  },
  ],
  video: [
    {
      id: "seedance-2",
      name: "Seedance",
      description: "ByteDance’s cinematic video model for polished, dynamic motion generation.",
      logo: "/models/seedance.svg",
    },
    {
      id: "kling-3",
      name: "Kling",
      description: "Kuaishou’s advanced video generation model for realistic scenes and movement.",
      logo: "/models/kling.svg",
    },
    {
      id: "veo-3.1",
      name: "Veo",
      description: "Google’s premium video model for high-fidelity cinematic generation.",
      logo: "/models/google.svg",
    },
    {
      id: "hailuo-2.3",
      name: "MiniMax Hailuo",
      description: "MiniMax’s Hailuo 2.3 video model for cinematic text-to-video and image-to-video generation.",
      logo: "/models/minimax-color.png",
    },
    {
      id: "wan-2.6",
      name: "Wan",
      description: "Alibaba’s efficient video model for fast, affordable creative motion workflows.",
      logo: "/models/qwen.svg",
    },
    {
      id: "vidu-q3",
      name: "Vidu",
      description: "Vidu’s Q3 video model for fast, cinematic motion generation.",
      logo: "/models/vidu.svg",
    },
  ],
  voice: [
    {
      id: "eleven-multilingual-v2",
      name: "Eleven Multilingual",
      description: "Natural multilingual voice generation for expressive speech across many languages.",
      logo: "/models/eleven.svg",
    },
    {
      id: "minimax-02-hd",
      name: "MiniMax",
      description: "MiniMax’s high-definition voice model for clear, polished spoken output.",
      logo: "/models/minimax-color.png",
    },
    {
      id: "cartesia-sonic-2",
      name: "Cartesia ",
      description: "Cartesia’s low-latency voice model optimized for fast, conversational speech.",
      logo: "/models/cartesia.svg",
    },
    
  ],
  music: [
    {
      id: "lyria-3",
      name: "Lyria",
      description: "Google’s music generation model for fast, polished instrumental creation.",
      logo: "/models/google.svg",
    },
    {
      id: "suno-v5.5",
      name: "Suno",
      description: "Suno’s music model for full-song generation with vocals, style and strong structure.",
      logo: "/models/suno.ico",
    },
  ],
};

export default function Explorar() {
  const [activeTab, setActiveTab] = useState("chat");
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

function handleTry(modelId) {
  const mode = activeTab === "chat" ? "chat" : "creative";

  const MODEL_MAP = {
    gpt: "gpt-5.4",
    claude: "claude-sonnet-4.5",
    gemini: "gemini-3 pro",
    grok: "grok-4",
    llama: "llama-4 maverick",
    mistral: "mistral-medium 3",
    deepseek: "deepseek-v3.2",
    qwen: "qwen3-max",
    perplexity: "perplexity-sonar",
    nemotron: "nemotron 3 super",
    minimax: "minimax m2.7",
    glm: "glm-4.7",
    kimi: "kimi-k2-5",


    // image
    "gpt-image": "gpt-image-1.5",
    flux: "flux-2-pro",
    ideogram: "ideogram-3",
    "nano-banana-2": "nano-banana-2",
    seedream: "seedream-4.5",
    "grok-image": "grok-image",
    "seedance-2": "seedance-2",
    "kling-3": "kling-3",
    "veo-3.1": "veo-3.1",
    "hailuo-2.3": "hailuo-2.3",
    "wan-2.6": "wan-2.6",
    "vidu-q3": "vidu-q3",
    "runway-gen-4.5": "vidu-q3",
    "eleven-multilingual-v2": "eleven-multilingual-v2",
    "minimax-02-hd": "minimax-02-hd",
    "cartesia-sonic-2": "cartesia-sonic-2",
    "eleven-v3": "eleven-v3",
    "lyria-3": "lyria-3",
    "lyria-3-pro": "lyria-3-pro",
    "suno-v5.5": "suno-v5.5",
  };

  const resolvedModel = MODEL_MAP[modelId] || modelId;

  // 🔥 PASSO 1: sair do Explore
  navigate(`/?model=${encodeURIComponent(resolvedModel)}&mode=${mode}&new=1`, { replace: false });
  return;

  // 🔥 PASSO 2: entrar no chat com força total
  // navigation handled above
}
  return (
  <div className="explore-page">
    <div className="explore-header">
      <h1 className="explore-title">Explore Assistants</h1>
      <p className="explore-subtitle">
Explore AI assistants, each optimized for a different workflow.
      </p>

    

      <div className="explore-tabs">
        <button
          className={activeTab === "chat" ? "active" : ""}
          onClick={() => setActiveTab("chat")}
        >
          AI Chat
        </button>
        <button
          className={activeTab === "image" ? "active" : ""}
          onClick={() => setActiveTab("image")}
        >
          AI Image
        </button>
        <button
          className={activeTab === "video" ? "active" : ""}
          onClick={() => setActiveTab("video")}
        >
          AI Video
        </button>
        <button
          className={activeTab === "voice" ? "active" : ""}
          onClick={() => setActiveTab("voice")}
        >
          AI Voice
        </button>
        <button
          className={activeTab === "music" ? "active" : ""}
          onClick={() => setActiveTab("music")}
        >
          AI Music
        </button>
      </div>
    </div>

      <div className="explore-grid">
        {MODELS[activeTab]
  .filter((m) =>
    m.name.toLowerCase().includes(query.toLowerCase())
  )
  .map((model) => (
          <div className="explore-card" key={model.id}>
            <div className="card-header">
              <img src={model.logo} alt={model.name} />
              <h3>{model.name}</h3>
            </div>

            <p className="card-description">{model.description}</p>

            <button className="try-btn" onClick={() => handleTry(model.id)}>
              Try it →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
