import { Command } from "commander"
import pc from "picocolors"
import { VERSION } from "@ibrax/core"
import {
  cmdChat,
  cmdDoctor,
  cmdInit,
  cmdMemoryList,
  cmdMemoryRemove,
  cmdMemorySearch,
  cmdPair,
  cmdSkills,
  cmdStart,
  cmdStatus,
} from "./commands.ts"

const program = new Command()

program
  .name("ibrax")
  .description("Ibra X — agen otonom untuk WhatsApp")
  .version(VERSION)

program.command("init").description("Wizard penyiapan: provider, model, akun").action(run(cmdInit))
program.command("start").description("Jalankan agen + server HTTP").action(run(cmdStart))
program
  .command("pair")
  .description("Tautkan akun WhatsApp dengan kode pairing")
  .argument("<accountId>", "ID akun (lihat `ibrax status`)")
  .argument("<phone>", "Nomor WhatsApp tanpa tanda plus, mis. 62812xxxxxxx")
  .action((accountId: string, phone: string) => run(() => cmdPair(accountId, phone))())
program.command("status").description("Tampilkan ringkasan status").action(run(cmdStatus))
program.command("doctor").description("Diagnostik lingkungan & penyedia").action(run(cmdDoctor))
program.command("skills").description("Daftar skill & tool terpasang").action(run(cmdSkills))

const memory = program.command("memory").description("Kelola memori jangka panjang")
memory
  .command("search")
  .description("Cari memori")
  .argument("<query>")
  .option("-l, --limit <n>", "jumlah hasil", "20")
  .action((query: string, opts: { limit: string }) => run(() => cmdMemorySearch(query, Number(opts.limit)))())
memory
  .command("list")
  .description("Daftar memori")
  .option("-l, --limit <n>", "jumlah hasil", "50")
  .action((opts: { limit: string }) => run(() => cmdMemoryList(Number(opts.limit)))())
memory
  .command("rm")
  .description("Hapus memori berdasarkan id")
  .argument("<id>")
  .action((id: string) => run(() => cmdMemoryRemove(id))())

program
  .command("chat")
  .description("Uji agen dari terminal (tanpa mengirim ke WhatsApp)")
  .argument("<text>")
  .option("-c, --chat <id>", "ID chat virtual")
  .option("-a, --account <id>", "ID akun")
  .action((text: string, opts: { chat?: string; account?: string }) => run(() => cmdChat(text, opts))())

function run(fn: () => Promise<void>): () => void {
  return () => {
    fn().catch((error) => {
      console.error(pc.red(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`))
      process.exitCode = 1
    })
  }
}

await program.parseAsync(process.argv)

if (!process.argv.slice(2).length) {
  program.outputHelp()
}
