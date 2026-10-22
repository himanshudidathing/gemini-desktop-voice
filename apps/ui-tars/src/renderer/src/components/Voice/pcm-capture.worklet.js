class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new ArrayBuffer(3200);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const value of channel) {
      const sample = Math.max(-1, Math.min(1, value));
      this.view.setInt16(
        this.offset,
        Math.round(sample * (sample < 0 ? 32768 : 32767)),
        true,
      );
      this.offset += 2;
      if (this.offset === 3200) {
        this.port.postMessage(this.buffer, [this.buffer]);
        this.buffer = new ArrayBuffer(3200);
        this.view = new DataView(this.buffer);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
