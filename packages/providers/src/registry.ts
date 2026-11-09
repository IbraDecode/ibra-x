import type { ProviderInfo } from "@ibrax/sdk"
import { createProvider, type CreateProviderOptions } from "./openai-compatible.ts"
import { PRESETS, findPreset } from "./presets.ts"

export interface ResolveProviderOptions extends CreateProviderOptions {
  providerId: string
  /** Kunci API eksplisit; jika kosong diambil dari variabel lingkungan preset. */
  apiKey?: string
}

export interface ProviderStatus {
  info: ProviderInfo
  hasKey: boolean
  available: boolean
}

/**
 * Membuat instance Provider dari id preset. Kunci API diambil dari opsi
 * eksplisit atau dari variabel lingkungan yang dideklarasikan preset.
 */
export function resolveProvider(opts: ResolveProviderOptions) {
  const preset = findPreset(opts.providerId)
  const info: ProviderInfo = preset ?? {
    id: opts.providerId,
    label: opts.providerId,
    baseUrl: opts.baseUrl ?? "",
    requiresKey: false,
  }

  let baseUrl = opts.baseUrl ?? info.baseUrl
  if (!baseUrl && opts.providerId === "custom") baseUrl = process.env.CUSTOM_BASE_URL ?? ""

  const apiKey = opts.apiKey ?? (info.apiKeyEnv ? process.env[info.apiKeyEnv] : undefined)

  if (info.requiresKey && !apiKey) {
    throw new Error(
      `Provider "${info.id}" memerlukan API key. Set variabel lingkungan ${info.apiKeyEnv ?? "(tidak diketahui)"} atau berikan apiKey secara eksplisit.`,
    )
  }
  if (!baseUrl) {
    throw new Error(`Provider "${info.id}" tidak memiliki baseUrl. Set CUSTOM_BASE_URL atau berikan baseUrl.`)
  }

  return createProvider(info, { ...opts, apiKey, baseUrl })
}

export function listProviders(): ProviderInfo[] {
  return PRESETS
}

/** Daftar provider beserta status ketersediaan kuncinya (untuk `ibrax doctor`). */
export function providerStatuses(): ProviderStatus[] {
  return PRESETS.map((info) => {
    const hasKey = info.requiresKey ? Boolean(info.apiKeyEnv && process.env[info.apiKeyEnv]) : true
    return { info, hasKey, available: hasKey }
  })
}

export { PRESETS, findPreset } from "./presets.ts"
export { createProvider, ProviderError } from "./openai-compatible.ts"
export type { CreateProviderOptions } from "./openai-compatible.ts"
