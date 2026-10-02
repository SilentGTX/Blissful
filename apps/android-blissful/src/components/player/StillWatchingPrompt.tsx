import { StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { Button } from '../ui/Button';
import { FocusTrap } from '../FocusTrap';

// "Are you still watching?" card, shown over the paused last frame once the
// player has auto-advanced N episodes in a row. No countdown: it waits for the
// viewer. Continue (default focus) plays the next episode; Exit and hardware
// Back (handled by the player) leave to the title's Detail page.
export function StillWatchingPrompt({
  lastPicked,
  onContinue,
  onExit,
}: {
  /** Label of the last episode the viewer started by hand, if known. */
  lastPicked: string | null;
  onContinue: () => void;
  onExit: () => void;
}) {
  const m = useMetrics();
  return (
    <View style={styles.overlay}>
      <FocusTrap
        style={{
          width: m.s(620),
          borderRadius: m.s(20),
          backgroundColor: '#101116',
          borderWidth: 1,
          borderColor: colors.hairline,
          padding: m.s(28),
        }}
      >
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(38), color: '#fff', }}>
          Are you still watching?
        </Text>
        {lastPicked ? (
          <Text style={{ fontFamily: font.body, fontSize: m.s(22), color: 'rgba(255,255,255,0.7)', marginTop: m.s(10) }}>
            Last episode you picked: <Text style={{ fontFamily: font.bodySemi, color: 'rgba(255,255,255,0.92)' }}>{lastPicked}</Text>
          </Text>
        ) : null}
        <View style={{ gap: m.s(12), marginTop: m.s(24) }}>
          <Button label="Continue watching" variant="accent" fullWidth autoFocus onPress={onContinue} />
          <Button label="Exit" fullWidth onPress={onExit} />
        </View>
      </FocusTrap>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
});
