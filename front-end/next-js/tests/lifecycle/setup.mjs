import { TextDecoder, TextEncoder } from "node:util";
import { ReadableStream } from "node:stream/web";

globalThis.TextEncoder ??= TextEncoder;
globalThis.TextDecoder ??= TextDecoder;
globalThis.ReadableStream ??= ReadableStream;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
