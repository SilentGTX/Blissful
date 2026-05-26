// Modal for joining a watch party by pasting a room code.
//
// Two-step state machine:
//   1. Code step — paste / type a 6-char code (auto-formatted to
//      `xxx-yyy`). On submit we look up the room via REST. If the
//      room is open, we navigate straight to the player. If the room
//      is password-protected, we transition to step 2 (still inside
//      this same modal).
//   2. Password step — typing a password and submitting verifies
//      against the server's verify endpoint, stashes the password in
//      sessionStorage, and navigates to the player.
//
// The player picks up the stashed password from sessionStorage so the
// useWatchParty hook can send it in the join message — passwords
// never go via URL params (which would land in browser history).

import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { useNavigate } from 'react-router-dom';
import {
  buildRoomPlayerUrl,
  formatRoomCodeInput,
  getWatchPartyRoom,
  isValidRoomCode,
  ROOM_CODE_LENGTH,
  stashWatchPartyPassword,
  verifyWatchPartyPassword,
  type WatchPartyRoomInfo,
} from '../../lib/watchParty';

type JoinPartyModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

type Step = { kind: 'code' } | { kind: 'password'; room: WatchPartyRoomInfo };

async function navigateToRoom(navigate: ReturnType<typeof useNavigate>, room: WatchPartyRoomInfo) {
  // buildRoomPlayerUrl fetches Cinemeta on our behalf and writes
  // poster / background / logo / metaTitle into the URL so the
  // AppShell buffer screen and player overlays render the title's
  // branding instead of a generic "Buffering" fallback.
  const url = await buildRoomPlayerUrl(room);
  navigate(url);
}

export function WatchPartyJoinModal({ isOpen, onOpenChange }: JoinPartyModalProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'code' });
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  // Reset every reopen.
  useEffect(() => {
    if (!isOpen) return;
    setStep({ kind: 'code' });
    setCode('');
    setPassword('');
    setReveal(false);
    setError(null);
    setBusy(false);
    window.setTimeout(() => codeInputRef.current?.focus(), 50);
  }, [isOpen]);

  // Autofocus password field when transitioning to step 2.
  useEffect(() => {
    if (step.kind === 'password') {
      window.setTimeout(() => passwordInputRef.current?.focus(), 50);
    }
  }, [step.kind]);

  const handleCodeChange = (raw: string) => {
    setCode(formatRoomCodeInput(raw));
    if (error) setError(null);
  };

  const handleCodeSubmit = async () => {
    if (!isValidRoomCode(code)) {
      setError('Enter the full 6-character code');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const room = await getWatchPartyRoom(code);
      if (!room) {
        setError('Room not found. Double-check the code.');
        setBusy(false);
        return;
      }
      if (room.hasPassword) {
        setStep({ kind: 'password', room });
        setBusy(false);
        return;
      }
      onOpenChange(false);
      await navigateToRoom(navigate, room);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to look up room');
      setBusy(false);
    }
  };

  const handlePasswordSubmit = async () => {
    if (step.kind !== 'password') return;
    if (!password.trim()) {
      setError('Enter the password');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await verifyWatchPartyPassword(step.room.code, password.trim());
    if (result === 'ok') {
      stashWatchPartyPassword(step.room.code, password.trim());
      onOpenChange(false);
      await navigateToRoom(navigate, step.room);
      return;
    }
    if (result === 'wrong-password') setError('Incorrect password');
    else if (result === 'no-room') setError('Room expired or was closed');
    else setError('Failed to verify password');
    setBusy(false);
  };

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        variant="blur"
        className="bg-black/40"
      >
        <Modal.Container placement="center">
          <Modal.Dialog className="bg-transparent shadow-none">
            <Modal.Header className="sr-only">
              <Modal.Heading>Join a watch party</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="px-0">
              <div className="solid-surface mx-auto w-full max-w-md rounded-[24px] bg-white/20 p-6">
                {step.kind === 'code' ? (
                  <>
                    <div className="text-lg font-semibold">Join a watch party</div>
                    <div className="mt-1 text-sm text-foreground/60">
                      Paste the room code your friend shared.
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!busy) handleCodeSubmit();
                      }}
                      className="mt-4"
                    >
                      <input
                        ref={codeInputRef}
                        type="text"
                        value={code}
                        onChange={(e) => handleCodeChange(e.target.value)}
                        placeholder="xxx-yyy"
                        maxLength={ROOM_CODE_LENGTH}
                        autoComplete="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-center font-mono text-2xl tracking-[0.35em] uppercase text-white placeholder:text-white/30 focus:border-[var(--bliss-accent)] focus:outline-none"
                      />
                      {error ? (
                        <div className="mt-2 text-sm text-red-400">{error}</div>
                      ) : null}
                      <div className="mt-5 flex gap-2">
                        <Button
                          type="submit"
                          className="rounded-full bg-white text-black"
                          isPending={busy}
                          isDisabled={busy || !isValidRoomCode(code)}
                        >
                          Continue
                        </Button>
                        <Button
                          variant="ghost"
                          className="rounded-full bg-white/10"
                          onPress={() => onOpenChange(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between">
                      <div className="text-lg font-semibold">Password required</div>
                      <button
                        type="button"
                        className="text-xs font-semibold text-white/60 hover:text-white"
                        onClick={() => {
                          setStep({ kind: 'code' });
                          setPassword('');
                          setError(null);
                        }}
                      >
                        Back
                      </button>
                    </div>
                    <div className="mt-1 text-sm text-foreground/60">
                      Room <span className="font-mono uppercase tracking-wider text-white/80">{step.room.code}</span> is password-protected.
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!busy) handlePasswordSubmit();
                      }}
                      className="mt-4"
                    >
                      <div className="relative">
                        <input
                          ref={passwordInputRef}
                          type={reveal ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            if (error) setError(null);
                          }}
                          placeholder="Room password"
                          maxLength={64}
                          autoComplete="off"
                          className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 pr-16 text-white placeholder:text-white/40 focus:border-[var(--bliss-accent)] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setReveal((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-white/60 hover:text-white"
                          tabIndex={-1}
                        >
                          {reveal ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      {error ? (
                        <div className="mt-2 text-sm text-red-400">{error}</div>
                      ) : null}
                      <div className="mt-5 flex gap-2">
                        <Button
                          type="submit"
                          className="rounded-full bg-white text-black"
                          isPending={busy}
                          isDisabled={busy || !password.trim()}
                        >
                          Join
                        </Button>
                        <Button
                          variant="ghost"
                          className="rounded-full bg-white/10"
                          onPress={() => onOpenChange(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  </>
                )}
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
