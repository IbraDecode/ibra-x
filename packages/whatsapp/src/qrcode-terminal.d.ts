declare module "qrcode-terminal" {
  interface GenerateOptions {
    small?: boolean
  }
  function generate(text: string, opts?: GenerateOptions, cb?: (code: string) => void): void
  function setErrorLevel(level: "L" | "M" | "Q" | "H"): void
  export { generate, setErrorLevel }
  const _default: { generate: typeof generate; setErrorLevel: typeof setErrorLevel }
  export default _default
}
