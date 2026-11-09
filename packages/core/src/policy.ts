import type { AutonomyLevel, RiskLevel } from "@ibrax/sdk"
import type { IbraConfig } from "./config.ts"

export type PolicyEffect = "allow" | "ask" | "deny"

export interface PolicyDecision {
  effect: PolicyEffect
  reason: string
}

export interface ToolDescriptor {
  name: string
  risk: RiskLevel
  requiresApproval?: boolean
}

/** Normalisasi identitas: hanya digit (nomor telepon). */
export function normalizeId(id: string): string {
  return id.replace(/[^0-9]/g, "")
}

export function isSameContact(a: string, b: string): boolean {
  const na = normalizeId(a)
  const nb = normalizeId(b)
  return na.length > 0 && na === nb
}

/**
 * Policy Engine Ibra X.
 *
 * Menentukan (1) siapa yang boleh memicu agen, dan (2) tool apa yang boleh
 * dijalankan. Prinsip: default-deny, aksi berisiko tinggi selalu bertanya.
 */
export class Policy {
  private readonly allow: Set<string>
  private readonly owners: Set<string>

  constructor(private readonly config: IbraConfig) {
    this.allow = new Set(config.allowlist.map(normalizeId).filter(Boolean))
    this.owners = new Set(config.ownerNumbers.map(normalizeId).filter(Boolean))
  }

  get allowlistEmpty(): boolean {
    return this.allow.size === 0
  }

  isOwner(id: string): boolean {
    return this.owners.has(normalizeId(id))
  }

  /**
   * Apakah pengirim boleh memicu agen.
   * Mode owner-only (allowlist kosong): hanya owner.
   */
  canTrigger(senderId: string, opts: { respondTo: "owner" | "allowlist" | "all" }): PolicyDecision {
    const nid = normalizeId(senderId)
    if (opts.respondTo === "all") return { effect: "allow", reason: "respondTo=all" }
    const owner = this.owners.has(nid)
    if (opts.respondTo === "owner") {
      return owner ? { effect: "allow", reason: "owner" } : { effect: "deny", reason: "bukan owner" }
    }
    // respondTo = allowlist
    if (owner) return { effect: "allow", reason: "owner" }
    if (this.allow.has(nid)) return { effect: "allow", reason: "ada di allowlist" }
    if (this.allowlistEmpty) return { effect: "deny", reason: "allowlist kosong (mode owner-only)" }
    return { effect: "deny", reason: "tidak ada di allowlist" }
  }

  /**
   * Keputusan menjalankan sebuah tool berdasarkan tingkat risiko dan otonomi.
   * Aturan: `deny` menang; `high` selalu `ask`; `readonly` menolak aksi keluar.
   */
  decideTool(tool: ToolDescriptor, opts: { autonomy?: AutonomyLevel; outbound?: boolean; isOwner?: boolean } = {}): PolicyDecision {
    const autonomy = opts.autonomy ?? this.config.autonomy

    if (tool.requiresApproval) {
      return { effect: "ask", reason: "tool menandai butuh persetujuan" }
    }

    if (autonomy === "readonly") {
      if (tool.risk === "low" && !opts.outbound) return { effect: "allow", reason: "readonly + tool baca" }
      return { effect: "deny", reason: "mode readonly: aksi yang mengubah keadaan ditolak" }
    }

    if (tool.risk === "high") {
      // Owner tetap harus menyetujui, kecuali mode autonomous penuh.
      return { effect: "ask", reason: "risiko tinggi butuh persetujuan" }
    }

    if (tool.risk === "medium") {
      if (autonomy === "suggest") return { effect: "ask", reason: "mode suggest: aksi tulis butuh persetujuan" }
      return { effect: "allow", reason: "mode mengizinkan aksi medium" }
    }

    return { effect: "allow", reason: "tool baca berisiko rendah" }
  }

  /** Apakah agen boleh mengirim pesan keluar secara otomatis pada tingkat otonomi ini. */
  canSendAutomatically(): boolean {
    return this.config.autonomy === "auto" || this.config.autonomy === "autonomous"
  }
}
