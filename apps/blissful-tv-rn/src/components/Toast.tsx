import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';

type M = ReturnType<typeof useMetrics>;

export type ToastOptions = {
  /** Auto-dismiss delay in ms. Default ~3.2s. */
  durationMs?: number;
};

type ToastItem = {
  id: number;
  message: string;
  durationMs: number;
};

const DEFAULT_DURATION_MS = 3200;
const MAX_VISIBLE = 4;

type ToastApi = {
  /** Queue a top-center glass-pill toast. Returns the toast id. */
  show: (message: string, opts?: ToastOptions) => number;
};

const ToastCtx = createContext<ToastApi | null>(null);

/**
 * Top-center toast host. Mirrors the web app's glass-pill toast
 * (rounded-full, bg-black/0.7, hairline border, white bodySemi text,
 * shadow, pointer-events: none, slide+fade from top, stacked).
 *
 * Mount ONCE at the app root, wrapping the navigator, so toasts float
 * above every screen. The host renders inside an absolute-fill,
 * pointer-events="none" overlay so it never intercepts D-pad focus.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: string, opts?: ToastOptions): number => {
    const id = nextId.current++;
    const durationMs = opts?.durationMs ?? DEFAULT_DURATION_MS;
    setToasts((prev) => {
      // Newest at the front; keep the stack bounded so a burst can't
      // pile up off-screen.
      const next = [{ id, message, durationMs }, ...prev];
      return next.slice(0, MAX_VISIBLE);
    });
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

function ToastHost({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const m = useMetrics();
  if (toasts.length === 0) return null;
  return (
    <View style={[styles.host, { top: m.s(48) }]} pointerEvents="none">
      {toasts.map((t) => (
        <ToastPill key={t.id} item={t} m={m} onDismiss={onDismiss} />
      ))}
    </View>
  );
}

function ToastPill({ item, m, onDismiss }: { item: ToastItem; m: M; onDismiss: (id: number) => void }) {
  // Drive both slide (translateY) and fade off a single 0->1 progress value.
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let dismissed = false;
    const finish = () => {
      if (dismissed) return;
      dismissed = true;
      onDismiss(item.id);
    };

    Animated.timing(progress, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => {
      Animated.timing(progress, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(finish);
    }, item.durationMs);

    return () => clearTimeout(timer);
  }, [progress, item.id, item.durationMs, onDismiss]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-m.s(24), 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pill,
        {
          opacity: progress,
          transform: [{ translateY }],
          marginBottom: m.s(10),
          borderRadius: radius.pill,
          paddingHorizontal: m.s(28),
          paddingVertical: m.s(14),
          maxWidth: Math.min(m.s(820), m.width * 0.72),
        },
      ]}
    >
      <Text
        numberOfLines={2}
        style={{ fontFamily: font.bodySemi, fontSize: m.s(20), lineHeight: m.s(26), color: colors.text, textAlign: 'center' }}
      >
        {item.message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Absolute, top-centred column. High zIndex so it floats above overlays
  // (StreamPicker is 250, TvSelect 300); pointer-events none so D-pad/focus
  // pass straight through to the screen beneath.
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 400,
    alignItems: 'center',
  },
  pill: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
});
