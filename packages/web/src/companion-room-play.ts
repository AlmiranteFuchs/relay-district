import {
  SIGNAL_COUNT, SIGNAL_CUE_MS, SIGNAL_GAP_MS,
  type CompanionPlayMessage, type CompanionPlayRequest, type Signal,
} from "../../shared/src/companion-play.ts";

let nextRequestId = 0;

type Round = Extract<CompanionPlayMessage, { type: "round" }>;
const signalName = (signal: Signal) => signal === "short" ? "Short" : "Long";

export class CompanionRoomPlay {
  private readonly name: string;
  private readonly send: (message: CompanionPlayRequest) => boolean;
  private readonly sound: (signal: Signal) => void;
  private readonly status: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly shortButton: HTMLButtonElement;
  private readonly longButton: HTMLButtonElement;
  private readonly portrait: HTMLImageElement;
  private round?: Round;
  private requestId?: number;
  private echo: Signal[] = [];
  private timer = 0;
  private animation?: Animation;

  constructor(
    body: HTMLElement,
    name: string,
    send: (message: CompanionPlayRequest) => boolean,
    sound: (signal: Signal) => void,
  ) {
    this.name = name;
    this.send = send;
    this.sound = sound;
    this.status = body.querySelector<HTMLElement>("#signal-status")!;
    this.startButton = body.querySelector<HTMLButtonElement>("#signal-start")!;
    this.shortButton = body.querySelector<HTMLButtonElement>("#signal-short")!;
    this.longButton = body.querySelector<HTMLButtonElement>("#signal-long")!;
    this.portrait = body.querySelector<HTMLImageElement>(".critter")!;
    this.startButton.addEventListener("click", () => this.start());
    this.shortButton.addEventListener("click", () => this.tap("short"));
    this.longButton.addEventListener("click", () => this.tap("long"));
    this.startButton.focus({ preventScroll: true });
  }

  private start() {
    const requestId = ++nextRequestId;
    if (!this.send({ type: "start", requestId })) {
      this.status.textContent = "Waiting for the plaza connection. Try again when you're online.";
      return;
    }
    window.clearTimeout(this.timer);
    this.requestId = requestId;
    this.startButton.disabled = true;
    this.status.textContent = this.name + " is getting ready.";
    this.status.focus({ preventScroll: true });
  }

  receive(message: CompanionPlayMessage) {
    if (message.type === "round") {
      if (message.requestId !== this.requestId) return;
      this.requestId = undefined;
      this.round = message;
      this.echo = [];
      this.cue(message, 0);
      return;
    }
    if (message.roundId !== this.round?.roundId) return;
    const pattern = this.round.signals.map(signalName).join(", ");
    if (message.outcome === "matched") {
      this.pulse(610);
      this.timer = window.setTimeout(() => this.sound("short"), 450);
      this.status.textContent = this.name + " answers with a happy trill." + (message.bondAdded ? " Bond +1." : "");
    } else if (message.outcome === "missed") {
      this.pulse(550, "7deg");
      this.status.textContent = this.name + " tilts its head. The pattern was " + pattern + ".";
    } else {
      this.status.textContent = this.name + " has settled down. Start another round when you're ready.";
    }
    this.resetControls();
  }

  private cue(round: Round, index: number) {
    if (index === round.signals.length) {
      this.status.textContent = "Your turn. Echo the four pulses in the same order.";
      this.shortButton.disabled = this.longButton.disabled = false;
      if (document.activeElement === this.status) this.shortButton.focus({ preventScroll: true });
      return;
    }
    const signal = round.signals[index];
    this.status.textContent = "Pulse " + (index + 1) + " of " + SIGNAL_COUNT + " · " + signalName(signal);
    this.sound(signal);
    this.pulse(signal === "short" ? 220 : 660);
    this.timer = window.setTimeout(() => {
      this.status.textContent = "…";
      this.timer = window.setTimeout(() => this.cue(round, index + 1), SIGNAL_GAP_MS);
    }, SIGNAL_CUE_MS);
  }

  private pulse(duration: number, tilt = "0deg") {
    this.animation?.cancel();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    this.animation = this.portrait.animate(
      [{ scale: "1", rotate: "0deg" }, { scale: "1.13", rotate: tilt, offset: .38 }, { scale: "1", rotate: "0deg" }],
      { duration, easing: "ease-in-out" },
    );
  }

  private tap(signal: Signal) {
    if (!this.round || this.echo.length >= SIGNAL_COUNT) return;
    this.echo.push(signal);
    this.sound(signal);
    if (this.echo.length < SIGNAL_COUNT) {
      this.status.textContent = "Echo " + this.echo.length + " of " + SIGNAL_COUNT + " · " + this.echo.map(signalName).join(", ");
      return;
    }
    this.shortButton.disabled = this.longButton.disabled = true;
    if (!this.send({ type: "answer", roundId: this.round.roundId, signals: this.echo })) {
      this.interrupt();
      return;
    }
    this.status.textContent = this.name + " listens to your reply.";
    this.status.focus({ preventScroll: true });
  }

  private resetControls() {
    this.requestId = undefined;
    this.round = undefined;
    this.echo = [];
    this.shortButton.disabled = this.longButton.disabled = true;
    this.startButton.disabled = false;
    this.startButton.textContent = "Play another round";
    if (document.activeElement === this.status) this.startButton.focus({ preventScroll: true });
  }

  interrupt() {
    window.clearTimeout(this.timer);
    this.animation?.cancel();
    this.status.textContent = "The plaza connection was interrupted. Start a new round when you're back online.";
    this.resetControls();
  }

  dispose() {
    window.clearTimeout(this.timer);
    this.animation?.cancel();
    if (this.round) this.send({ type: "cancel", roundId: this.round.roundId });
  }
}
