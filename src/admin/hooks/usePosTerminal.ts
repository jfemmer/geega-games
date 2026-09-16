import { useCallback, useRef, useState } from "react";
import { loadStripeTerminal, type Terminal, type Reader } from "@stripe/terminal-js";
import { posRepository } from "../repositories";

// Thin wrapper around Stripe Terminal JS for the register: discover/connect to
// an internet-connected smart reader (Stripe Reader S700 / BBPOS WisePOS E),
// then collect + process a card-present payment for a PaymentIntent the
// server already created (see api/admin?resource=pos&action=terminal-create-intent).
//
// The terminal instance is created lazily and cached for the component's
// lifetime — connecting to a reader is a real, slightly slow hardware
// handshake, so we don't want to redo it on every render.

export type TerminalConnectionState = "disconnected" | "connecting" | "connected";

export function usePosTerminal() {
  const terminalRef = useRef<Terminal | null>(null);
  const [connection, setConnection] = useState<TerminalConnectionState>("disconnected");
  const [readers, setReaders] = useState<Reader[]>([]);
  const [connectedReader, setConnectedReader] = useState<Reader | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ensureTerminal = useCallback(async (): Promise<Terminal> => {
    if (terminalRef.current) return terminalRef.current;
    const StripeTerminal = await loadStripeTerminal();
    if (!StripeTerminal) {
      throw new Error("Stripe Terminal failed to load. Check your internet connection.");
    }
    const terminal = StripeTerminal.create({
      onFetchConnectionToken: () => posRepository.terminalConnectionToken(),
      onUnexpectedReaderDisconnect: () => {
        setConnection("disconnected");
        setConnectedReader(null);
        setError("The reader disconnected unexpectedly.");
      },
    });
    terminalRef.current = terminal;
    return terminal;
  }, []);

  const discoverReaders = useCallback(async (locationId?: string) => {
    setError(null);
    setBusy(true);
    try {
      const terminal = await ensureTerminal();
      const result = await terminal.discoverReaders(
        locationId ? { location: locationId } : {},
      );
      if ("error" in result) {
        setError(result.error.message || "Could not find any readers.");
        setReaders([]);
        return;
      }
      setReaders(result.discoveredReaders);
      if (result.discoveredReaders.length === 0) {
        setError("No readers found. Make sure it's powered on and registered to this location.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not find any readers.");
    } finally {
      setBusy(false);
    }
  }, [ensureTerminal]);

  const connectReader = useCallback(async (reader: Reader) => {
    setError(null);
    setConnection("connecting");
    setBusy(true);
    try {
      const terminal = await ensureTerminal();
      const result = await terminal.connectReader(reader);
      if ("error" in result) {
        setConnection("disconnected");
        setError(result.error.message || "Could not connect to that reader.");
        return;
      }
      setConnectedReader(result.reader);
      setConnection("connected");
    } catch (err) {
      setConnection("disconnected");
      setError(err instanceof Error ? err.message : "Could not connect to that reader.");
    } finally {
      setBusy(false);
    }
  }, [ensureTerminal]);

  /** Collects a card on the connected reader and charges the given PaymentIntent. */
  const collectAndProcess = useCallback(async (clientSecret: string) => {
    const terminal = await ensureTerminal();
    const collected = await terminal.collectPaymentMethod(clientSecret);
    if ("error" in collected) {
      throw new Error(collected.error.message || "Could not read the card. Please try again.");
    }
    const processed = await terminal.processPayment(collected.paymentIntent);
    if ("error" in processed) {
      throw new Error(processed.error.message || "The card was declined.");
    }
    return processed.paymentIntent;
  }, [ensureTerminal]);

  return {
    connection,
    readers,
    connectedReader,
    error,
    busy,
    discoverReaders,
    connectReader,
    collectAndProcess,
  };
}
