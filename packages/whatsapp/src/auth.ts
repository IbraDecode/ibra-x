import { resolve } from "node:path"
import { useMultiFileAuthState } from "@whiskeysockets/baileys"
import type { AuthenticationState } from "@whiskeysockets/baileys"

export interface LoadedAuth {
  state: AuthenticationState
  saveCreds: () => Promise<void>
  dir: string
}

/**
 * Memuat state autentikasi WhatsApp per akun. Sesi disimpan di
 * `<dataDir>/auth/<accountId>`.
 *
 * PENTING: direktori ini berisi kredensial akun. Perlakukan sebagai rahasia:
 * jangan commit, batasi izin file, dan enkripsi at-rest bila memungkinkan.
 */
export async function loadAuthState(dataDir: string, accountId: string): Promise<LoadedAuth> {
  const dir = resolve(dataDir, "auth", accountId)
  const { state, saveCreds } = await useMultiFileAuthState(dir)
  return { state, saveCreds, dir }
}
