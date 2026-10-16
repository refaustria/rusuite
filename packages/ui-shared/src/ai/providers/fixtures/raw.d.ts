// Recorded server-sent-event streams, imported as text by the adapter tests (Vite `?raw`).
declare module "*.sse?raw" {
  const text: string;
  export default text;
}
