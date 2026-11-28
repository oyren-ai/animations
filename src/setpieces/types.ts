export interface SetPieceSpec {
  readonly id: string;
  readonly slug: "setpiece-glass-floors" | "setpiece-hex-chain";
  readonly title: string;
  readonly questionPrefix: string;
  readonly questionHighlight: string;
  readonly ruleLine1: string;
  readonly ruleLine2: string;
  readonly seed: number;
  readonly totalFrames: number;
  readonly holdFrames: number;
  readonly payoffFrame: number;
}

export interface SetPieceAudioResult {
  readonly wav: Uint8Array;
  readonly peakDb: number;
  readonly rmsDb: number;
}

export interface SetPieceModule<TTrace> {
  readonly spec: SetPieceSpec;
  simulate(): TTrace;
  paint(ctx: CanvasRenderingContext2D, trace: TTrace, frame: number): void;
  synthesizeAudio(trace: TTrace): SetPieceAudioResult;
}
