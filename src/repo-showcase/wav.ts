/** Browser-safe RIFF/WAV reader shared by the voice generator, audio mix, and clip checks. */
export interface Pcm16Wav {
  readonly format: 1;
  readonly channels: 1 | 2;
  readonly sampleRate: number;
  readonly bitsPerSample: 16;
  readonly frames: number;
  /** Interleaved signed samples, copied so sliced input buffers work correctly. */
  readonly samples: Int16Array;
}

function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

export function parsePcm16Wav(bytes: Uint8Array): Pcm16Wav {
  if (bytes.byteLength < 12 || tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WAVE") {
    throw new Error("expected a RIFF/WAVE file");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd < 12 || riffEnd > bytes.byteLength) throw new Error("truncated RIFF/WAVE file");

  let format: number | undefined;
  let channels: number | undefined;
  let sampleRate: number | undefined;
  let bitsPerSample: number | undefined;
  let blockAlign: number | undefined;
  let dataStart: number | undefined;
  let dataSize: number | undefined;
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const id = tag(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    const next = body + size + (size % 2);
    if (next > riffEnd) throw new Error(`truncated WAV ${id} chunk`);
    if (id === "fmt " && format === undefined) {
      if (size < 16) throw new Error("truncated WAV fmt chunk");
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      blockAlign = view.getUint16(body + 12, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data" && dataStart === undefined) {
      dataStart = body;
      dataSize = size;
    }
    offset = next;
  }

  if (format === undefined || channels === undefined || sampleRate === undefined || bitsPerSample === undefined || blockAlign === undefined) {
    throw new Error("WAV without a fmt chunk");
  }
  if (format !== 1 || bitsPerSample !== 16) throw new Error("expected PCM16 WAV audio");
  if (channels !== 1 && channels !== 2) throw new Error("expected a mono or stereo WAV");
  if (sampleRate <= 0 || blockAlign !== channels * 2) throw new Error("invalid PCM16 WAV format");
  if (dataStart === undefined || dataSize === undefined) throw new Error("WAV without a data chunk");
  if (dataSize % blockAlign !== 0) throw new Error("WAV data is not frame aligned");

  const samples = new Int16Array(dataSize / 2);
  for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(dataStart + index * 2, true);
  return { format: 1, channels, sampleRate, bitsPerSample: 16, frames: dataSize / blockAlign, samples };
}

/** Milliseconds of leading silence below -45 dBFS; 0 for an entirely silent clip. */
export function leadingSilenceMs(bytes: Uint8Array): number {
  const wav = parsePcm16Wav(bytes);
  const threshold = 32768 * 10 ** (-45 / 20);
  for (let frame = 0; frame < wav.frames; frame++) {
    for (let channel = 0; channel < wav.channels; channel++) {
      if (Math.abs(wav.samples[frame * wav.channels + channel]) > threshold) return (frame / wav.sampleRate) * 1000;
    }
  }
  return 0;
}
