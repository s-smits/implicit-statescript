// A WebSocket client whose connection state is spelled as flags. excessive-bools reports the class
// (five boolean fields) and co-assigned-flags reports the fields its methods write together.

export class Connection {
  connecting = false;
  open = false;
  closing = false;
  closed = true;
  reconnecting = false;
  retries = 0;

  connect(): void {
    this.connecting = true;
    this.open = false;
    this.closed = false;
  }

  onOpen(): void {
    this.connecting = false;
    this.open = true;
    this.closed = false;
  }

  onClose(): void {
    this.connecting = false;
    this.open = false;
    this.closed = true;
  }
}

// Passes: optional settings are independent choices, not one state.
export interface ConnectOptions {
  secure?: boolean;
  compress?: boolean;
  keepAlive?: boolean;
  binary?: boolean;
}

// Passes: the state has one owner.
export type ConnectionState = "connecting" | "open" | "closing" | "closed";
