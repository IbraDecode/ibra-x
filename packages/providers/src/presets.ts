import type { ProviderInfo } from "@ibrax/sdk"

/**
 * Preset penyedia. Semuanya berbicara protokol OpenAI Chat Completions,
 * sehingga satu engine generik (`openaiCompatible`) dapat melayani semuanya.
 * Ini yang membuat Ibra X "terhubung langsung ke penyedia" tanpa SDK berat.
 *
 * Cukup tambahkan entri di sini untuk mendukung penyedia baru yang kompatibel.
 */
export const PRESETS: ProviderInfo[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    requiresKey: true,
    recommendedModels: ["gpt-4.1", "gpt-4.1-mini", "o4-mini"],
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    requiresKey: true,
    recommendedModels: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  },
  {
    id: "google",
    label: "Google (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GOOGLE_API_KEY",
    requiresKey: true,
    recommendedModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    requiresKey: true,
    recommendedModels: ["anthropic/claude-sonnet-4.5", "openai/gpt-4.1-mini", "google/gemini-2.5-flash"],
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    requiresKey: true,
    recommendedModels: ["llama-3.3-70b-versatile"],
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    requiresKey: true,
    recommendedModels: ["mistral-large-latest", "mistral-small-latest"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    requiresKey: true,
    recommendedModels: ["deepseek-chat"],
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    requiresKey: true,
    recommendedModels: ["grok-4", "grok-3-mini"],
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
    requiresKey: true,
  },
  {
    id: "ollama",
    label: "Ollama (lokal)",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKeyEnv: "OLLAMA_API_KEY",
    requiresKey: false,
    recommendedModels: ["llama3.1", "qwen2.5"],
  },
  {
    id: "custom",
    label: "Kustom (OpenAI-compatible)",
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKeyEnv: "CUSTOM_API_KEY",
    requiresKey: false,
  },
]

export const PRESET_BY_ID: Record<string, ProviderInfo> = Object.fromEntries(PRESETS.map((p) => [p.id, p]))

export function findPreset(id: string): ProviderInfo | undefined {
  return PRESET_BY_ID[id]
}
