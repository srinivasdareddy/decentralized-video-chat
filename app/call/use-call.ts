import { useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { CallSession, INITIAL_CALL_STATE, type CallNotice } from "./call-session";
import { INITIAL_MEDIA_STATE, LocalMedia } from "./local-media";

interface Session {
  media: LocalMedia;
  call: CallSession;
}

/**
 * Runs a call in `room` for as long as the component is mounted: asks for
 * the camera and microphone, then joins. Leaving the page ends the call.
 */
export function useCall(room: string) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const media = new LocalMedia();
    const call = new CallSession({ room, media });
    // The session wraps browser resources, so it's created here rather than
    // during render, and exposed once it exists.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession({ media, call });
    void media.start().then((ready) => {
      if (ready) call.start();
    });
    return () => {
      call.dispose();
      media.dispose();
    };
  }, [room]);

  const media = useStore(session?.media.store ?? null, INITIAL_MEDIA_STATE);
  const call = useStore(session?.call.store ?? null, INITIAL_CALL_STATE);

  const actions = useMemo(
    () => ({
      retryMedia(): void {
        if (session === null) return;
        void session.media.start().then((ready) => {
          if (ready) session.call.start();
        });
      },
      toggleMicrophone(): void {
        session?.media.toggleMicrophone();
      },
      toggleCamera(): void {
        session?.media.toggleCamera();
      },
      /** Resolves to false if sharing couldn't start. */
      async toggleScreenShare(): Promise<boolean> {
        if (session === null) return false;
        if (session.media.store.get().sharingScreen) {
          session.media.stopScreenShare();
          return true;
        }
        return session.media.startScreenShare();
      },
      setCaptions(on: boolean): boolean {
        return session?.call.setCaptions(on) ?? false;
      },
      sendChat(text: string): boolean {
        return session?.call.sendChat(text) ?? false;
      },
      onNotice(listener: (notice: CallNotice) => void): () => void {
        return session?.call.onNotice(listener) ?? (() => {});
      },
    }),
    [session],
  );

  return { media, call, actions };
}
